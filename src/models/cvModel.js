const { pool } = require("../config/db");

const CVModel = {
  /**
   * Save CV analysis record into cv_analysis table
   */
  async saveCVAnalysis(data) {
    const {
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
      targetCompany,
      targetJobRole,
      targetExpertiseLevel,
      status,
    } = data;

    const query = `
      INSERT INTO cv_analysis (
        user_id,
        file_name,
        file_path,
        raw_text,
        parsed_data,
        candidate_name,
        email,
        phone,
        experience_years,
        skills,
        suggested_role,
        suggested_level,
        target_company,
        target_job_role,
        target_expertise_level,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await pool.query(query, [
      userId,
      fileName,
      filePath,
      rawText,
      JSON.stringify(parsedData),
      candidateName || null,
      email || null,
      phone || null,
      experienceYears || null,
      JSON.stringify(skills || []),
      suggestedRole || null,
      suggestedLevel || null,
      targetCompany || null,
      targetJobRole || null,
      targetExpertiseLevel || null,
      status || "started",
    ]);

    return result.insertId;
  },

  /**
   * Get latest CV analysis record for a user
   */
  async getLatestCVByUserId(userId) {
    const query = `
      SELECT * FROM cv_analysis
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const [rows] = await pool.query(query, [userId]);
    if (!rows || rows.length === 0) return null;
    return this.formatRecord(rows[0]);
  },

  /**
   * Get CV analysis by ID and user ID
   */
  async getCVAnalysisById(id, userId) {
    const query = `
      SELECT * FROM cv_analysis
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `;
    const [rows] = await pool.query(query, [id, userId]);
    if (!rows || rows.length === 0) return null;
    return this.formatRecord(rows[0]);
  },

  /**
   * Get all CV analyses for a user
   */
  /**
   * Get all CV analyses for a user
   */
  async getUserCVAnalyses(userId) {
    const query = `
      SELECT id, user_id, file_name, candidate_name, email, suggested_role, suggested_level, target_company, target_job_role, target_expertise_level, status, created_at
      FROM cv_analysis
      WHERE user_id = ?
      ORDER BY created_at DESC
    `;
    const [rows] = await pool.query(query, [userId]);
    return rows;
  },

  /**
   * Update CV analysis record with Interview Context (Company, Job Role, Expertise Level)
   */
  async updateInterviewContext({ cvId, userId, targetCompany, targetJobRole, targetExpertiseLevel }) {
    if (cvId) {
      await pool.query(
        `UPDATE cv_analysis 
         SET target_company = ?, target_job_role = ?, target_expertise_level = ?, status = 'started' 
         WHERE id = ? AND user_id = ?`,
        [targetCompany || null, targetJobRole || null, targetExpertiseLevel || null, cvId, userId]
      );
    } else {
      await pool.query(
        `UPDATE cv_analysis 
         SET target_company = ?, target_job_role = ?, target_expertise_level = ?, status = 'started' 
         WHERE user_id = ? 
         ORDER BY created_at DESC 
         LIMIT 1`,
        [targetCompany || null, targetJobRole || null, targetExpertiseLevel || null, userId]
      );
    }

    return this.getLatestCVByUserId(userId);
  },

  /**
   * Safely parse JSON fields when returning database record
   */
  formatRecord(record) {
    if (!record) return null;
    let parsedData = record.parsed_data;
    if (typeof parsedData === "string") {
      try {
        parsedData = JSON.parse(parsedData);
      } catch (e) {
        // Keep string if fail
      }
    }

    let skills = record.skills;
    if (typeof skills === "string") {
      try {
        skills = JSON.parse(skills);
      } catch (e) {
        skills = [];
      }
    }

    return {
      ...record,
      parsed_data: parsedData,
      skills: skills || [],
    };
  },
};

module.exports = CVModel;
