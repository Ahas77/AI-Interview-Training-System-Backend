const { pool } = require("../config/db");

const CompanyModel = {
  /**
   * Find or create a company record with normalized name
   */
  async findOrCreateCompany(name, officialCareersUrl = null) {
    if (!name || !name.trim()) return null;
    const cleanName = name.trim();
    const normalizedName = cleanName.toLowerCase().replace(/[^a-z0-9]/g, "");

    const [existing] = await pool.query(
      "SELECT * FROM companies WHERE normalized_name = ? LIMIT 1",
      [normalizedName]
    );

    if (existing && existing.length > 0) {
      if (officialCareersUrl && !existing[0].official_careers_url) {
        await pool.query(
          "UPDATE companies SET official_careers_url = ? WHERE id = ?",
          [officialCareersUrl, existing[0].id]
        );
      }
      return existing[0];
    }

    const [result] = await pool.query(
      "INSERT INTO companies (name, normalized_name, official_careers_url) VALUES (?, ?, ?)",
      [cleanName, normalizedName, officialCareersUrl]
    );

    return {
      id: result.insertId,
      name: cleanName,
      normalized_name: normalizedName,
      official_careers_url: officialCareersUrl,
    };
  },

  /**
   * Check if a job posting already exists by content hash (SHA-256)
   */
  async findJobPostingByHash(contentHash) {
    if (!contentHash) return null;
    const [rows] = await pool.query(
      "SELECT * FROM company_job_postings WHERE content_hash = ? LIMIT 1",
      [contentHash]
    );
    return rows.length > 0 ? rows[0] : null;
  },

  /**
   * Find recent verified job posting for a company and job role
   */
  async findRecentPosting(companyId, jobRole) {
    const [rows] = await pool.query(
      `SELECT * FROM company_job_postings 
       WHERE company_id = ? AND LOWER(job_title) LIKE LOWER(?) 
       ORDER BY last_verified_at DESC LIMIT 1`,
      [companyId, `%${jobRole.trim()}%`]
    );
    return rows.length > 0 ? rows[0] : null;
  },

  /**
   * Insert new company job posting
   */
  async createJobPosting(data) {
    const {
      companyId,
      externalJobId = null,
      jobTitle,
      location = "Any / Remote",
      seniorityLevel = "Intermediate",
      sourceUrl,
      sourceType = "careers_page",
      rawJobDescription = "",
      publishedAt = null,
      contentHash,
      status = "verified",
    } = data;

    const [result] = await pool.query(
      `INSERT INTO company_job_postings (
        company_id, external_job_id, job_title, location, seniority_level,
        source_url, source_type, raw_job_description, published_at,
        last_verified_at, status, content_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
      [
        companyId,
        externalJobId,
        jobTitle,
        location,
        seniorityLevel,
        sourceUrl,
        sourceType,
        rawJobDescription,
        publishedAt,
        status,
        contentHash,
      ]
    );

    return result.insertId;
  },

  /**
   * Update existing job posting last verified timestamp
   */
  async touchJobPosting(id) {
    await pool.query(
      "UPDATE company_job_postings SET last_verified_at = NOW(), status = 'verified' WHERE id = ?",
      [id]
    );
  },

  /**
   * Save extracted requirements with source evidence
   */
  async saveJobRequirements(jobPostingId, requirementsList) {
    if (!jobPostingId || !Array.isArray(requirementsList) || requirementsList.length === 0) {
      return 0;
    }

    // Delete older requirements for this posting to refresh
    await pool.query("DELETE FROM company_job_requirements WHERE job_posting_id = ?", [jobPostingId]);

    const values = [];
    for (const req of requirementsList) {
      if (!req.name && !req.requirement_name) continue;
      values.push([
        jobPostingId,
        req.category || req.requirement_category || "skill",
        req.name || req.requirement_name,
        req.type || req.requirement_type || "required",
        req.description || req.requirement_description || "",
        req.evidence_excerpt || req.evidence || "",
      ]);
    }

    if (values.length === 0) return 0;

    const query = `
      INSERT INTO company_job_requirements (
        job_posting_id, requirement_category, requirement_name, 
        requirement_type, requirement_description, evidence_excerpt
      ) VALUES ?
    `;

    const [result] = await pool.query(query, [values]);
    return result.affectedRows;
  },

  /**
   * Get all verified requirements for a specific job posting
   */
  async getRequirementsByPostingId(jobPostingId) {
    const [rows] = await pool.query(
      `SELECT * FROM company_job_requirements 
       WHERE job_posting_id = ? 
       ORDER BY requirement_type ASC, requirement_category ASC`,
      [jobPostingId]
    );
    return rows;
  },

  /**
   * Log search request
   */
  async logSearch({ companyName, jobRole, seniorityLevel, location, searchStatus, resultsCount, errorMessage = null }) {
    try {
      await pool.query(
        `INSERT INTO company_search_logs (
          company_name, job_role, seniority_level, location, search_status, results_count, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          companyName || "Unknown",
          jobRole || "Software Engineer",
          seniorityLevel || "Intermediate",
          location || "Any",
          searchStatus || "pending",
          resultsCount || 0,
          errorMessage,
        ]
      );
    } catch (e) {
      console.warn("Failed to log company search:", e.message);
    }
  },

  /**
   * Get job posting with requirements by ID
   */
  async getPostingDetails(postingId) {
    const [postings] = await pool.query(
      `SELECT p.*, c.name as company_name, c.official_careers_url 
       FROM company_job_postings p
       JOIN companies c ON p.company_id = c.id
       WHERE p.id = ? LIMIT 1`,
      [postingId]
    );

    if (postings.length === 0) return null;
    const posting = postings[0];
    posting.requirements = await this.getRequirementsByPostingId(postingId);
    return posting;
  },
};

module.exports = CompanyModel;
