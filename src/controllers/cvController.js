const path = require("path");
const { extractTextFromDocument } = require("../services/documentTextExtractor");
const { parseResume } = require("../services/aiResumeParser");
const CVModel = require("../models/cvModel");

const cvController = {
  /**
   * POST /api/cv/upload
   * Handles CV file upload, text extraction, OCR fallback, AI resume parsing, & MySQL persistence
   */
  async uploadAndAnalyzeCV(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized. Authentication required.",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No CV file provided.",
        });
      }

      const userId = req.user.id;
      const file = req.file;
      const filePath = file.path;
      const originalName = file.originalname;
      const savedFileName = file.filename;

      // 1. Extract text from PDF / DOCX (with OCR fallback if scanned)
      let textResult;
      try {
        textResult = await extractTextFromDocument(filePath, originalName);
      } catch (extractErr) {
        return res.status(400).json({
          success: false,
          message: `Text extraction failed: ${extractErr.message}`,
        });
      }

      const rawText = textResult.text;
      const extractionMethod = textResult.extractionMethod;

      if (!rawText || rawText.trim().length === 0) {
        return res.status(422).json({
          success: false,
          message: "Unable to extract text from this CV. The file might be corrupted or unreadable.",
        });
      }

      // 2. AI Resume Parsing
      let parsedData;
      try {
        parsedData = await parseResume(rawText);
      } catch (aiErr) {
        console.error("AI Resume parsing controller error:", aiErr);
        return res.status(500).json({
          success: false,
          message: "AI analysis failed on extracted text. Please try again.",
        });
      }

      // 3. Extract key top-level metadata for MySQL columns
      const candidateName = parsedData.candidate?.full_name || null;
      const email = parsedData.candidate?.email || null;
      const phone = parsedData.candidate?.phone || null;
      const experienceYears = parsedData.experience_years || null;
      const skills = parsedData.skills || parsedData.technical_skills || [];
      const suggestedRole =
        parsedData.suggested_job_roles && parsedData.suggested_job_roles.length > 0
          ? parsedData.suggested_job_roles[0]
          : null;
      const suggestedLevel = parsedData.expertise_level || null;

      // Save CV Analysis record directly into cv_analysis table in MySQL
      let insertId = null;
      try {
        insertId = await CVModel.saveCVAnalysis({
          userId,
          fileName: originalName,
          filePath: savedFileName,
          rawText,
          parsedData,
          candidateName,
          email,
          phone,
          experienceYears,
          skills,
          suggestedRole,
          suggestedLevel,
          targetCompany: null,
          targetJobRole: suggestedRole,
          targetExpertiseLevel: suggestedLevel,
          status: "uploaded",
        });
      } catch (dbErr) {
        console.error("Error saving CV analysis record to DB on upload:", dbErr);
      }

      // Return structured JSON response WITH inserted ID
      return res.status(200).json({
        success: true,
        message: "CV analyzed and saved successfully",
        data: {
          id: insertId,
          user_id: userId,
          file_name: originalName,
          file_path: savedFileName,
          raw_text: rawText,
          extraction_method: extractionMethod,
          candidate: parsedData.candidate,
          candidate_name: candidateName,
          email,
          phone,
          professional_summary: parsedData.professional_summary,
          skills,
          technical_skills: parsedData.technical_skills,
          soft_skills: parsedData.soft_skills,
          experience_years: experienceYears,
          expertise_level: suggestedLevel,
          suggested_job_roles: parsedData.suggested_job_roles,
          suggested_role: suggestedRole,
          suggested_level: suggestedLevel,
          parsed_data: parsedData,
          created_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("uploadAndAnalyzeCV Controller Error:", error);
      return res.status(500).json({
        success: false,
        message: "An internal server error occurred while processing the CV.",
      });
    }
  },

  /**
   * GET /api/cv/latest
   * Returns authenticated user's latest CV analysis
   */
  async getLatestCV(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized.",
        });
      }

      const cvRecord = await CVModel.getLatestCVByUserId(req.user.id);
      if (!cvRecord) {
        return res.status(404).json({
          success: false,
          message: "No CV analysis found for this user.",
        });
      }

      return res.status(200).json({
        success: true,
        data: cvRecord,
      });
    } catch (error) {
      console.error("getLatestCV Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch latest CV analysis.",
      });
    }
  },

  /**
   * GET /api/cv/:id
   * Returns specific CV analysis by ID for authenticated user
   */
  async getCVById(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized.",
        });
      }

      const cvId = parseInt(req.params.id, 10);
      if (isNaN(cvId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid CV analysis ID.",
        });
      }

      const cvRecord = await CVModel.getCVAnalysisById(cvId, req.user.id);
      if (!cvRecord) {
        return res.status(404).json({
          success: false,
          message: "CV analysis not found or access denied.",
        });
      }

      return res.status(200).json({
        success: true,
        data: cvRecord,
      });
    } catch (error) {
      console.error("getCVById Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch CV analysis record.",
      });
    }
  },

  /**
   * POST /api/cv/start-interview
   * Saves complete CV Analysis + Interview Context (Company, Job Role, Expertise Level) to DB
   */
  async saveInterviewContext(req, res) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized. Authentication required.",
        });
      }

      const userId = req.user.id;
      const { cvData, cvId, company, jobRole, expertiseLevel } = req.body;

      if (!jobRole || !expertiseLevel) {
        return res.status(400).json({
          success: false,
          message: "Job role and expertise level are required.",
        });
      }

      let savedRecord = null;

      // If full cvData object is passed from fresh upload, insert new complete record into DB
      if (cvData) {
        const fileName = cvData.file_name || "Uploaded_CV.pdf";
        const filePath = cvData.file_path || fileName;
        const rawText = cvData.raw_text || "";
        const parsedData = cvData.parsed_data || cvData || {};
        const candidateName = parsedData.candidate?.full_name || cvData.candidate_name || null;
        const email = parsedData.candidate?.email || cvData.email || null;
        const phone = parsedData.candidate?.phone || cvData.phone || null;
        const experienceYears = cvData.experience_years ?? parsedData.experience_years ?? null;
        const skills = cvData.skills || parsedData.skills || [];
        const suggestedRole = cvData.suggested_role || (parsedData.suggested_job_roles && parsedData.suggested_job_roles.length > 0 ? parsedData.suggested_job_roles[0] : null);
        const suggestedLevel = cvData.suggested_level || parsedData.expertise_level || null;

        const insertId = await CVModel.saveCVAnalysis({
          userId,
          fileName,
          filePath,
          rawText,
          parsedData,
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

        savedRecord = await CVModel.getCVAnalysisById(insertId, userId);
      } else {
        // If cvId is passed or updating existing record
        savedRecord = await CVModel.updateInterviewContext({
          cvId: cvId ? parseInt(cvId, 10) : null,
          userId,
          targetCompany: company,
          targetJobRole: jobRole,
          targetExpertiseLevel: expertiseLevel,
        });
      }

      return res.status(200).json({
        success: true,
        message: "Interview session created and saved in database successfully.",
        data: savedRecord,
      });
    } catch (error) {
      console.error("saveInterviewContext Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to save interview context.",
      });
    }
  },
};

module.exports = cvController;
