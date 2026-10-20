const { pool } = require("../config/db");

const BehavioralAnalysisModel = {
  async createSession(userId) {
    const [result] = await pool.query(
      `INSERT INTO behavioral_analysis_sessions
       (user_id, status, baseline_samples) VALUES (?, 'collecting_baseline', ?)`,
      [userId, JSON.stringify([])]
    );
    return result.insertId;
  },

  async getSessionById(sessionId, userId) {
    const [rows] = await pool.query(
      `SELECT * FROM behavioral_analysis_sessions WHERE id = ? AND user_id = ? LIMIT 1`,
      [sessionId, userId]
    );
    return rows[0] || null;
  },

  async saveBaseline(sessionId, samples, durationSeconds) {
    await pool.query(
      `UPDATE behavioral_analysis_sessions
       SET baseline_samples = ?, baseline_duration_seconds = ?, status = 'baseline_ready'
       WHERE id = ?`,
      [JSON.stringify(samples), durationSeconds, sessionId]
    );
  },

  async saveInterviewResult(sessionId, samples, result) {
    await pool.query(
      `UPDATE behavioral_analysis_sessions
       SET interview_samples = ?, result = ?, status = 'completed'
       WHERE id = ?`,
      [JSON.stringify(samples), JSON.stringify(result), sessionId]
    );
  },

  formatSession(session) {
    if (!session) return null;
    const parseJson = (value, fallback) => {
      if (typeof value !== "string") return value || fallback;
      try {
        return JSON.parse(value);
      } catch (error) {
        return fallback;
      }
    };

    return {
      ...session,
      baseline_samples: parseJson(session.baseline_samples, []),
      interview_samples: parseJson(session.interview_samples, []),
      result: parseJson(session.result, null),
    };
  },
};

module.exports = BehavioralAnalysisModel;
