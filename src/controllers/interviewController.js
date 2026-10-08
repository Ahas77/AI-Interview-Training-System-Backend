const InterviewModel = require("../models/interviewModel");
const HRAiAgentService = require("../services/hrAiAgentService");
const CVModel = require("../models/cvModel");

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

      // Ensure CV Analysis record exists & updated in cv_analysis table
      if (cvData) {
        cvRawText = cvData.raw_text || "";
        cvParsedData = cvData.parsed_data || cvData;

        // If cvData has an id already, update its context
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
          // If cvData has no id, save new CV analysis into cv_analysis table
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
        // Try getting latest CV for user
        const latestCv = await CVModel.getLatestCVByUserId(userId);
        if (latestCv) {
          validCvId = latestCv.id;
          cvRawText = latestCv.raw_text || "";
          cvParsedData = typeof latestCv.parsed_data === "string" ? JSON.parse(latestCv.parsed_data) : latestCv.parsed_data;
        }
      }

      // 1. Create Interview Session in MySQL
      const sessionId = await InterviewModel.createSession({
        userId,
        cvId: validCvId,
        targetCompany: company || null,
        jobRole: jobRole || "Software Engineer",
        expertiseLevel: expertiseLevel || "Intermediate",
        totalQuestions: 5,
      });

      const userFullName = req.user ? `${req.user.first_name || ""} ${req.user.last_name || ""}`.trim() : "";

      // 2. Generate Question #1 using AI HR Agent Service
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

      // 3. Log Question 1 in DB
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

      // If session is in_progress but has no logs yet, generate Question 1
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

  /**
   * POST /api/interview/submit-answer
   * Saves candidate's answer and generates next question OR completes session
   */
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
};

module.exports = interviewController;
