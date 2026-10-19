const CompanyRequirementsService = require("../services/companyRequirementsService");
const CompanyModel = require("../models/companyModel");
const { pool } = require("../config/db");

const companyRequirementsController = {

  async searchRequirements(req, res) {
    try {
      const { company, jobRole, seniority, location } = req.body;

      if (!company || !company.trim()) {
        return res.status(400).json({
          success: false,
          message: "Target company name is required for live requirements search.",
        });
      }

      const result = await CompanyRequirementsService.getOrSearchRequirements({
        company: company.trim(),
        jobRole: (jobRole || "Software Engineer").trim(),
        seniority: seniority || "Intermediate",
        location: (location || "Any").trim(),
      });

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error("searchRequirements Controller Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to search and extract company job requirements.",
      });
    }
  },

  async getCompanyRequirements(req, res) {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      if (isNaN(companyId)) {
        return res.status(400).json({ success: false, message: "Invalid company ID." });
      }

      const [postings] = await pool.query(
        `SELECT p.*, c.name as company_name 
         FROM company_job_postings p
         JOIN companies c ON p.company_id = c.id
         WHERE p.company_id = ? 
         ORDER BY p.last_verified_at DESC`,
        [companyId]
      );

      for (const posting of postings) {
        posting.requirements = await CompanyModel.getRequirementsByPostingId(posting.id);
      }

      return res.status(200).json({
        success: true,
        postings,
      });
    } catch (error) {
      console.error("getCompanyRequirements Controller Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch company requirements.",
      });
    }
  },

  async listRecentPostings(req, res) {
    try {
      const [rows] = await pool.query(`
        SELECT p.id, p.job_title, p.location, p.seniority_level, p.source_url, 
               p.source_type, p.last_verified_at, c.id as company_id, c.name as company_name,
               (SELECT COUNT(*) FROM company_job_requirements r WHERE r.job_posting_id = p.id) as requirement_count
        FROM company_job_postings p
        JOIN companies c ON p.company_id = c.id
        ORDER BY p.last_verified_at DESC
        LIMIT 20
      `);

      return res.status(200).json({
        success: true,
        postings: rows,
      });
    } catch (error) {
      console.error("listRecentPostings Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch recent company postings.",
      });
    }
  },
};

module.exports = companyRequirementsController;
