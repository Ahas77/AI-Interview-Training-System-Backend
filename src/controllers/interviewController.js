const InterviewModel = require("../models/interviewModel");
const HRAiAgentService = require("../services/hrAiAgentService");
const TechnicalAiAgentService = require("../services/technicalAiAgentService");
const CompanyModel = require("../models/companyModel");
const CompanyRequirementsService = require("../services/companyRequirementsService");
const CVModel = require("../models/cvModel");
const UserModel = require("../models/userModel");
const { pool } = require("../config/db");

const interviewController = {
  /**
   * POST /api/interview/start
   * Initializes session and generates Question 1
   */
  async startSession(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, message: "Unauthorized." });
      }

      const userId = req.user.id;
      const { cvId, company, jobRole, expertiseLevel, cvData } = req.body;

      let validCvId = cvId ? parseInt(cvId, 10) : null;
      let cvRawText = "";
      let cvParsedData = null;

      if (cvData) {
        cvRawText = cvData.raw_text || "";
        cvParsedData = cvData.parsed_data || cvData;

        if (cvData.id || validCvId) {
          validCvId = cvData.id || validCvId;
          await CVModel.updateInterviewContext({
            cvId: validCvId,
            userId,
            targetCompany: company,
            targetJobRole: jobRole,
            targetExpertiseLevel: expertiseLevel,
          });
        } else {
          const fileName = cvData.file_name || "Uploaded_CV.pdf";
          const filePath = cvData.file_path || fileName;
          const candidateName = cvParsedData.candidate?.full_name || cvData.candidate_name || null;
          const email = cvParsedData.candidate?.email || cvData.email || null;
          const phone = cvParsedData.candidate?.phone || cvData.phone || null;
          const experienceYears = cvData.experience_years ?? cvParsedData.experience_years ?? null;
          const skills = cvData.skills || cvParsedData.skills || [];
          const suggestedRole = cvData.suggested_role || (cvParsedData.suggested_job_roles && cvParsedData.suggested_job_roles.length > 0 ? cvParsedData.suggested_job_roles[0] : null);
          const suggestedLevel = cvData.suggested_level || cvParsedData.expertise_level || null;

          validCvId = await CVModel.saveCVAnalysis({
            userId,
            fileName,
            filePath,
            rawText: cvRawText,
            parsedData: cvParsedData,
            candidateName,
            email,
            phone,
            experienceYears,
            skills,
            suggestedRole,
            suggestedLevel,
            targetCompany: company,
            targetJobRole: jobRole,
            targetExpertiseLevel: expertiseLevel,
            status: "started",
          });
        }
      } else if (validCvId) {
        const cvRecord = await CVModel.getCVAnalysisById(validCvId, userId);
        if (cvRecord) {
          cvRawText = cvRecord.raw_text || "";
          cvParsedData = typeof cvRecord.parsed_data === "string" ? JSON.parse(cvRecord.parsed_data) : cvRecord.parsed_data;
          await CVModel.updateInterviewContext({
            cvId: validCvId,
            userId,
            targetCompany: company,
            targetJobRole: jobRole,
            targetExpertiseLevel: expertiseLevel,
          });
        }
      } else {
        const latestCv = await CVModel.getLatestCVByUserId(userId);
        if (latestCv) {
          validCvId = latestCv.id;
          cvRawText = latestCv.raw_text || "";
          cvParsedData = typeof latestCv.parsed_data === "string" ? JSON.parse(latestCv.parsed_data) : latestCv.parsed_data;
        }
      }

      const sessionId = await InterviewModel.createSession({
        userId,
        cvId: validCvId,
        targetCompany: company || null,
        jobRole: jobRole || "Software Engineer",
        expertiseLevel: expertiseLevel || "Intermediate",
        totalQuestions: 5,
      });

      // Update user status and active session in users table
      await UserModel.updateInterviewStatus(userId, "hr_pending", sessionId);

      if (validCvId) {
        try {
          await pool.query("UPDATE cv_analysis SET status = 'hr_pending' WHERE id = ?", [validCvId]);
        } catch (cvErr) {
          console.error("Error updating cv_analysis status to hr_pending:", cvErr);
        }
      }

      const userFullName = req.user ? `${req.user.first_name || ""} ${req.user.last_name || ""}`.trim() : "";

      const question1Text = await HRAiAgentService.generateNextQuestion({
        cvRawText,
        cvParsedData,
        jobRole: jobRole || "Software Engineer",
        company: company || "Tech Company",
        expertiseLevel: expertiseLevel || "Intermediate",
        previousQA: [],
        questionNumber: 1,
        userName: userFullName,
      });

      const qaId = await InterviewModel.logQuestion(sessionId, 1, question1Text);

      return res.status(200).json({
        success: true,
        message: "Interview session started successfully.",
        sessionId,
        totalQuestions: 5,
        currentQuestion: {
          id: qaId,
          questionNumber: 1,
          text: question1Text,
        },
      });
    } catch (error) {
      console.error("startSession Controller Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to initialize interview session.",
      });
    }
  },

  /**
   * GET /api/interview/session/:id
   * Fetches active session state & Q&A history
   */
  async getSession(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, message: "Unauthorized." });
      }

      const sessionId = parseInt(req.params.id, 10);
      if (isNaN(sessionId)) {
        return res.status(400).json({ success: false, message: "Invalid session ID." });
      }

      const session = await InterviewModel.getSessionById(sessionId, req.user.id);
      if (!session) {
        return res.status(404).json({ success: false, message: "Interview session not found." });
      }

      let qaLogs = await InterviewModel.getQALogs(sessionId);

      if (qaLogs.length === 0 && session.status === "in_progress") {
        let cvParsedData = null;
        if (session.cv_parsed_data) {
          cvParsedData = typeof session.cv_parsed_data === "string" ? JSON.parse(session.cv_parsed_data) : session.cv_parsed_data;
        }

        const q1Text = await HRAiAgentService.generateNextQuestion({
          cvRawText: session.cv_raw_text || "",
          cvParsedData,
          jobRole: session.job_role,
          company: session.target_company,
          expertiseLevel: session.expertise_level,
          previousQA: [],
          questionNumber: 1,
        });

        const qaId = await InterviewModel.logQuestion(sessionId, 1, q1Text);
        qaLogs = [{ id: qaId, question_number: 1, question_text: q1Text, user_answer_text: null }];
      }

      const latestQA = qaLogs[qaLogs.length - 1];

      return res.status(200).json({
        success: true,
        session,
        qaLogs,
        currentQuestion: latestQA
          ? {
              id: latestQA.id,
              questionNumber: latestQA.question_number,
              text: latestQA.question_text,
              userAnswer: latestQA.user_answer_text,
            }
          : null,
      });
    } catch (error) {
      console.error("getSession Controller Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch session details.",
      });
    }
  },


  async submitAnswer(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, message: "Unauthorized." });
      }

      const { sessionId, qaId, userAnswerText } = req.body;

      if (!sessionId || !qaId) {
        return res.status(400).json({ success: false, message: "sessionId and qaId are required." });
      }

      const session = await InterviewModel.getSessionById(sessionId, req.user.id);
      if (!session) {
        return res.status(404).json({ success: false, message: "Session not found or access denied." });
      }

      // 1. Save user answer
      await InterviewModel.saveAnswer(qaId, userAnswerText);

      // 2. Check if all questions completed
      if (session.current_question_index >= session.total_questions) {
        await InterviewModel.completeSession(sessionId);
        await UserModel.updateInterviewStatus(req.user.id, "hr_completed", null);
        if (session.cv_id) {
          try {
            await pool.query("UPDATE cv_analysis SET status = 'hr_completed' WHERE id = ?", [session.cv_id]);
          } catch (cvErr) {
            console.error("Error updating cv_analysis status to hr_completed:", cvErr);
          }
        }
        return res.status(200).json({
          success: true,
          isCompleted: true,
          message: "Interview finished successfully.",
        });
      }

      // 3. Move to next question
      const nextIndex = session.current_question_index + 1;
      await InterviewModel.updateQuestionIndex(sessionId, nextIndex);

      // 4. Fetch previous Q&A history for AI prompt
      const previousLogs = await InterviewModel.getQALogs(sessionId);
      const previousQA = previousLogs.map((log) => ({
        question: log.question_text,
        answer: log.user_answer_text || "No answer provided",
      }));

      let cvParsedData = null;
      if (session.cv_parsed_data) {
        cvParsedData = typeof session.cv_parsed_data === "string" ? JSON.parse(session.cv_parsed_data) : session.cv_parsed_data;
      }

      const userFullName = req.user ? `${req.user.first_name || ""} ${req.user.last_name || ""}`.trim() : "";

      // 5. Generate Next Question via AI HR Agent
      const nextQuestionText = await HRAiAgentService.generateNextQuestion({
        cvRawText: session.cv_raw_text || "",
        cvParsedData,
        jobRole: session.job_role,
        company: session.target_company,
        expertiseLevel: session.expertise_level,
        previousQA,
        questionNumber: nextIndex,
        userName: userFullName,
      });

      // 6. Save Next Question into DB
      const nextQaId = await InterviewModel.logQuestion(sessionId, nextIndex, nextQuestionText);

      return res.status(200).json({
        success: true,
        isCompleted: false,
        currentQuestion: {
          id: nextQaId,
          questionNumber: nextIndex,
          text: nextQuestionText,
        },
      });
    } catch (error) {
      console.error("submitAnswer Controller Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to submit answer.",
      });
    }
  },

  /**
   * POST /api/interview/complete
   * Marks session as complete explicitly
   */
  async completeSession(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, message: "Unauthorized." });
      }

      const { sessionId } = req.body;
      if (!sessionId) {
        return res.status(400).json({ success: false, message: "Session ID required." });
      }

      await InterviewModel.completeSession(sessionId);
      await UserModel.updateInterviewStatus(req.user.id, "hr_completed", null);

      return res.status(200).json({
        success: true,
        message: "Interview session marked as completed.",
      });
    } catch (error) {
      console.error("completeSession Controller Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to complete interview session.",
      });
    }
  },

  /**
   * POST /api/interview/technical/start
   * Initializes 10-Question Technical Interview Session grounded in CV + Company Requirements
   */
  async startTechnicalSession(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, message: "Unauthorized." });
      }

      const userId = req.user.id;
      const { parentSessionId, company, jobRole, expertiseLevel, jobPostingId } = req.body;

      // 1. Retrieve Candidate CV details
      let cvId = null;
      let cvRawText = "";
      let cvParsedData = null;

      if (parentSessionId) {
        const parentSession = await InterviewModel.getSessionById(parentSessionId, userId);
        if (parentSession) {
          cvId = parentSession.cv_id;
          cvRawText = parentSession.cv_raw_text || "";
          cvParsedData = typeof parentSession.cv_parsed_data === "string"
            ? JSON.parse(parentSession.cv_parsed_data)
            : parentSession.cv_parsed_data;
        }
      }

      if (!cvParsedData) {
        const latestCv = await CVModel.getLatestCVByUserId(userId);
        if (latestCv) {
          cvId = latestCv.id;
          cvRawText = latestCv.raw_text || "";
          cvParsedData = typeof latestCv.parsed_data === "string"
            ? JSON.parse(latestCv.parsed_data)
            : latestCv.parsed_data;
        }
      }

      const targetCompany = company || "Tech Company";
      const targetRole = jobRole || "Software Engineer";
      const targetLevel = expertiseLevel || "Intermediate";

      // 2. Fetch or load verified company requirements
      let companyRequirements = [];
      let resolvedPostingId = jobPostingId ? parseInt(jobPostingId, 10) : null;

      if (resolvedPostingId) {
        companyRequirements = await CompanyModel.getRequirementsByPostingId(resolvedPostingId);
      } else {
        const searchRes = await CompanyRequirementsService.getOrSearchRequirements({
          company: targetCompany,
          jobRole: targetRole,
          seniority: targetLevel,
        });
        if (searchRes.jobPostingId) {
          resolvedPostingId = searchRes.jobPostingId;
          companyRequirements = searchRes.requirements || [];
        }
      }

      // 3. Create Technical Session in interview_sessions (total_questions = 10)
      const technicalSessionId = await InterviewModel.createTechnicalSession({
        userId,
        cvId,
        targetCompany,
        jobRole: targetRole,
        expertiseLevel: targetLevel,
        jobPostingId: resolvedPostingId,
        parentSessionId: parentSessionId || null,
      });

      // 4. Update user status in users table
      await UserModel.updateInterviewStatus(userId, "technical_pending", technicalSessionId);

      const userFullName = req.user ? `${req.user.first_name || ""} ${req.user.last_name || ""}`.trim() : "";

      // 5. Generate Question #1 via Technical AI Agent
      const question1Data = await TechnicalAiAgentService.generateTechnicalQuestion({
        cvRawText,
        cvParsedData,
        jobRole: targetRole,
        company: targetCompany,
        expertiseLevel: targetLevel,
        companyRequirements,
        previousQA: [],
        questionNumber: 1,
        userName: userFullName,
      });

      const question1Text = question1Data?.question || "Could you explain the memory model and execution lifecycle of your primary programming language?";

      // 6. Log Question 1 in DB
      const qaId = await InterviewModel.logQuestion(technicalSessionId, 1, question1Text);

      return res.status(200).json({
        success: true,
        message: "Technical interview session started successfully.",
        sessionId: technicalSessionId,
        totalQuestions: 10,
        currentQuestion: {
          id: qaId,
          questionNumber: 1,
          category: question1Data?.question_category || "Core Language & Runtime Mechanics",
          text: question1Text,
          contextHint: question1Data?.context_hint || null,
          codeSnippet: question1Data?.code_snippet || null,
        },
        companyRequirements,
      });
    } catch (error) {
      console.error("startTechnicalSession Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to initialize technical interview session.",
      });
    }
  },

  /**
   * GET /api/interview/technical/session/:id
   * Fetches active technical session, QA history, and company requirements
   */
  async getTechnicalSession(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, message: "Unauthorized." });
      }

      const sessionId = parseInt(req.params.id, 10);
      if (isNaN(sessionId)) {
        return res.status(400).json({ success: false, message: "Invalid session ID." });
      }

      const session = await InterviewModel.getSessionById(sessionId, req.user.id);
      if (!session) {
        return res.status(404).json({ success: false, message: "Technical session not found." });
      }

      let qaLogs = await InterviewModel.getQALogs(sessionId);

      // Load company requirements if posting linked
      let companyRequirements = [];
      if (session.job_posting_id) {
        companyRequirements = await CompanyModel.getRequirementsByPostingId(session.job_posting_id);
      }

      // If session is in_progress but has no logs yet, generate Question 1
      if (qaLogs.length === 0 && (session.status === "in_progress" || session.status === "technical_pending")) {
        let cvParsedData = null;
        if (session.cv_parsed_data) {
          cvParsedData = typeof session.cv_parsed_data === "string" ? JSON.parse(session.cv_parsed_data) : session.cv_parsed_data;
        }

        const q1Data = await TechnicalAiAgentService.generateTechnicalQuestion({
          cvRawText: session.cv_raw_text || "",
          cvParsedData,
          jobRole: session.job_role,
          company: session.target_company,
          expertiseLevel: session.expertise_level,
          companyRequirements,
          previousQA: [],
          questionNumber: 1,
        });

        const q1Text = q1Data?.question || "Could you explain the memory model and execution lifecycle of your primary programming language?";
        const qaId = await InterviewModel.logQuestion(sessionId, 1, q1Text);
        qaLogs = [{ id: qaId, question_number: 1, question_text: q1Text, user_answer_text: null }];
      }

      const latestQA = qaLogs[qaLogs.length - 1];

      return res.status(200).json({
        success: true,
        session,
        qaLogs,
        companyRequirements,
        totalQuestions: 10,
        currentQuestion: latestQA
          ? {
              id: latestQA.id,
              questionNumber: latestQA.question_number,
              text: latestQA.question_text,
              userAnswer: latestQA.user_answer_text,
            }
          : null,
      });
    } catch (error) {
      console.error("getTechnicalSession Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to load technical interview session.",
      });
    }
  },

  /**
   * POST /api/interview/technical/submit-answer
   * Submits candidate technical answer, handles up to 10 questions
   */
  async submitTechnicalAnswer(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, message: "Unauthorized." });
      }

      const { sessionId, qaId, userAnswerText } = req.body;
      if (!sessionId || !qaId) {
        return res.status(400).json({ success: false, message: "Missing sessionId or qaId." });
      }

      const session = await InterviewModel.getSessionById(sessionId, req.user.id);
      if (!session) {
        return res.status(404).json({ success: false, message: "Session not found." });
      }

      // 1. Save user answer
      await InterviewModel.saveAnswer(qaId, userAnswerText);

      // 2. Check if all 10 questions are completed
      const totalQ = session.total_questions || 10;
      if (session.current_question_index >= totalQ) {
        await InterviewModel.completeSession(sessionId);
        await UserModel.updateInterviewStatus(req.user.id, "technical_completed", null);

        return res.status(200).json({
          success: true,
          isCompleted: true,
          message: "All 10 Technical Questions completed successfully!",
        });
      }

      // 3. Move to next question (2 to 10)
      const nextIndex = session.current_question_index + 1;
      await InterviewModel.updateQuestionIndex(sessionId, nextIndex);

      // 4. Fetch previous Q&A history
      const previousLogs = await InterviewModel.getQALogs(sessionId);
      const previousQA = previousLogs.map((log) => ({
        question: log.question_text,
        answer: log.user_answer_text || "No answer provided",
      }));

      let cvParsedData = null;
      if (session.cv_parsed_data) {
        cvParsedData = typeof session.cv_parsed_data === "string" ? JSON.parse(session.cv_parsed_data) : session.cv_parsed_data;
      }

      // Load company requirements
      let companyRequirements = [];
      if (session.job_posting_id) {
        companyRequirements = await CompanyModel.getRequirementsByPostingId(session.job_posting_id);
      }

      const userFullName = req.user ? `${req.user.first_name || ""} ${req.user.last_name || ""}`.trim() : "";

      // 5. Generate Next Technical Question (Question #2..#10)
      const nextQuestionData = await TechnicalAiAgentService.generateTechnicalQuestion({
        cvRawText: session.cv_raw_text || "",
        cvParsedData,
        jobRole: session.job_role,
        company: session.target_company,
        expertiseLevel: session.expertise_level,
        companyRequirements,
        previousQA,
        questionNumber: nextIndex,
        userName: userFullName,
      });

      const nextQuestionText = nextQuestionData?.question || `Question #${nextIndex}: Please solve this technical challenge for ${session.job_role}.`;

      // 6. Save Next Question into DB
      const nextQaId = await InterviewModel.logQuestion(sessionId, nextIndex, nextQuestionText);

      return res.status(200).json({
        success: true,
        isCompleted: false,
        totalQuestions: 10,
        currentQuestion: {
          id: nextQaId,
          questionNumber: nextIndex,
          category: nextQuestionData?.question_category || `Technical Question #${nextIndex}`,
          text: nextQuestionText,
          contextHint: nextQuestionData?.context_hint || null,
          codeSnippet: nextQuestionData?.code_snippet || null,
        },
      });
    } catch (error) {
      console.error("submitTechnicalAnswer Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to submit technical answer.",
      });
    }
  },

  /**
   * POST /api/interview/technical/complete
   */
  async completeTechnicalSession(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, message: "Unauthorized." });
      }

      const { sessionId } = req.body;
      if (!sessionId) {
        return res.status(400).json({ success: false, message: "Session ID required." });
      }

      await InterviewModel.completeSession(sessionId);
      await UserModel.updateInterviewStatus(req.user.id, "technical_completed", null);

      return res.status(200).json({
        success: true,
        message: "Technical interview round marked as completed.",
      });
    } catch (error) {
      console.error("completeTechnicalSession Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to complete technical interview session.",
      });
    }
  },

  /**
   * GET /api/interview/user-status
   * Returns current interview_status and active_session_id for authenticated user
   */
  async getUserStatus(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, message: "Unauthorized." });
      }

      const userId = req.user.id;
      const user = await UserModel.findById(userId);

      let status = user?.interview_status || "no_cv";
      let activeSessionId = user?.active_session_id || null;

      // Validate hr_pending or technical_pending active session
      if (status === "hr_pending" || status === "technical_pending") {
        if (activeSessionId) {
          const session = await InterviewModel.getSessionById(activeSessionId, userId);
          if (!session || session.status === "completed" || session.status === "hr_completed" || session.status === "technical_completed") {
            status = session?.round_type === "technical" ? "technical_completed" : "hr_completed";
            activeSessionId = null;
            await UserModel.updateInterviewStatus(userId, status, null);
          }
        } else {
          const activeSession = await InterviewModel.getActiveSessionByUserId(userId);
          if (activeSession) {
            activeSessionId = activeSession.id;
            status = activeSession.round_type === "technical" ? "technical_pending" : "hr_pending";
            await UserModel.updateInterviewStatus(userId, status, activeSessionId);
          } else {
            status = "cv_uploaded";
            await UserModel.updateInterviewStatus(userId, "cv_uploaded", null);
          }
        }
      }

      return res.status(200).json({
        success: true,
        interview_status: status,
        active_session_id: activeSessionId,
      });
    } catch (error) {
      console.error("getUserStatus Controller Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch user interview status.",
      });
    }
  },

  /**
   * POST /api/interview/reset
   * Resets user interview status to allow fresh CV upload / setup
   */
  async resetInterviewStatus(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, message: "Unauthorized." });
      }

      await UserModel.updateInterviewStatus(req.user.id, "no_cv", null);

      return res.status(200).json({
        success: true,
        message: "Interview status reset. Ready for new interview.",
      });
    } catch (error) {
      console.error("resetInterviewStatus Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to reset interview status.",
      });
    }
  },
};

module.exports = interviewController;
