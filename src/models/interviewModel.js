const { pool } = require("../config/db");

const InterviewModel = {
  /**
   * Create a new interview session
   */
  async createSession(data) {
    const { userId, cvId, targetCompany, jobRole, expertiseLevel, totalQuestions = 5 } = data;

    const query = `
      INSERT INTO interview_sessions (
        user_id,
        cv_id,
        target_company,
        job_role,
        expertise_level,
        status,
        total_questions,
        current_question_index
      ) VALUES (?, ?, ?, ?, ?, 'in_progress', ?, 1)
    `;

    const [result] = await pool.query(query, [
      userId,
      cvId || null,
      targetCompany || null,
      jobRole,
      expertiseLevel,
      totalQuestions,
    ]);

    return result.insertId;
  },

  /**
   * Get session by ID and User ID
   */
  async getSessionById(sessionId, userId) {
    const query = `
      SELECT s.*, c.raw_text as cv_raw_text, c.parsed_data as cv_parsed_data
      FROM interview_sessions s
      LEFT JOIN cv_analysis c ON s.cv_id = c.id
      WHERE s.id = ? AND s.user_id = ?
    `;

    const [rows] = await pool.query(query, [sessionId, userId]);
    return rows.length > 0 ? rows[0] : null;
  },

  /**
   * Log a new generated question for a session
   */
  async logQuestion(sessionId, questionNumber, questionText) {
    const query = `
      INSERT INTO interview_qa_logs (
        session_id,
        question_number,
        question_text
      ) VALUES (?, ?, ?)
    `;

    const [result] = await pool.query(query, [sessionId, questionNumber, questionText]);
    return result.insertId;
  },

  /**
   * Save user's answer for a specific question log ID
   */
  async saveAnswer(qaId, userAnswerText) {
    const query = `
      UPDATE interview_qa_logs
      SET user_answer_text = ?
      WHERE id = ?
    `;

    await pool.query(query, [userAnswerText || "", qaId]);
  },

  /**
   * Get all Q&A logs for a session
   */
  async getQALogs(sessionId) {
    const query = `
      SELECT id, question_number, question_text, user_answer_text, created_at
      FROM interview_qa_logs
      WHERE session_id = ?
      ORDER BY question_number ASC
    `;

    const [rows] = await pool.query(query, [sessionId]);
    return rows;
  },

  /**
   * Update current question index
   */
  async updateQuestionIndex(sessionId, nextIndex) {
    const query = `
      UPDATE interview_sessions
      SET current_question_index = ?
      WHERE id = ?
    `;

    await pool.query(query, [nextIndex, sessionId]);
  },

  /**
   * Mark interview session as completed
   */
  async completeSession(sessionId) {
    const query = `
      UPDATE interview_sessions
      SET status = 'completed', completed_at = NOW()
      WHERE id = ?
    `;

    await pool.query(query, [sessionId]);
  },
};

module.exports = InterviewModel;
