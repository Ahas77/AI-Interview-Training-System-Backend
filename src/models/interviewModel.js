const { pool } = require("../config/db");
const { classifyQuestion } = require("../services/c3AiService");

const InterviewModel = {
  /**
   * Create a new interview session
   */
  async createSession(data) {
    const { userId, cvId, targetCompany, jobRole, expertiseLevel, totalQuestions = 5 } = data;
    const [countRows] = await pool.query(
      "SELECT COUNT(*) AS count FROM interview_sessions WHERE user_id = ? AND session_type <> 'warmup'",
      [userId]
    );
    const sessionNumber = (countRows[0]?.count || 0) + 1;

    const query = `
      INSERT INTO interview_sessions (
        user_id,
        cv_id,
        target_company,
        job_role,
        expertise_level,
        session_type,
        session_number,
        status,
        total_questions,
        current_question_index
      ) VALUES (?, ?, ?, ?, ?, 'interview', ?, 'in_progress', ?, 1)
    `;

    const [result] = await pool.query(query, [
      userId,
      cvId || null,
      targetCompany || null,
      jobRole,
      expertiseLevel,
      sessionNumber,
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
        question_text,
        question_type
      ) VALUES (?, ?, ?, ?)
    `;

    const [result] = await pool.query(query, [sessionId, questionNumber, questionText, classifyQuestion(questionText)]);
    return result.insertId;
  },

  /**
   * Save user's answer for a specific question log ID
   */
  async saveAnswer(qaId, sessionId, userAnswerText) {
    const wordCount = String(userAnswerText || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;

    const query = `
      UPDATE interview_qa_logs
      SET
        user_answer_text = ?,
        answered_at = NOW(),
        answer_word_count = ?,
        response_latency_sec = TIMESTAMPDIFF(SECOND, created_at, NOW())
      WHERE id = ? AND session_id = ?
    `;

    const [result] = await pool.query(query, [userAnswerText || "", wordCount, qaId, sessionId]);
    return result.affectedRows > 0;
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

  async saveEvaluation(qaId, sessionId, evaluation) {
    await pool.query(`UPDATE interview_qa_logs SET question_type = ?, answer_score = ?, answer_feedback = ? WHERE id = ? AND session_id = ?`,
      [evaluation.questionType, evaluation.score, evaluation.feedback, qaId, sessionId]);
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
