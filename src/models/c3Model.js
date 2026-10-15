const { pool } = require("../config/db");
const { safeJson } = require("../services/c3AnalyticsService");

const C3Model = {
  async getUserById(userId) {
    const [rows] = await pool.query("SELECT id, role FROM users WHERE id = ? LIMIT 1", [userId]);
    return rows[0] || null;
  },

  async getSessionForUser(sessionId, userId) {
    const [rows] = await pool.query(
      "SELECT * FROM interview_sessions WHERE id = ? AND user_id = ? LIMIT 1",
      [sessionId, userId]
    );
    return rows[0] || null;
  },

  async getSessionAny(sessionId) {
    const [rows] = await pool.query("SELECT * FROM interview_sessions WHERE id = ? LIMIT 1", [sessionId]);
    return rows[0] || null;
  },

  async createWarmupSession({ userId, targetCompany = null, jobRole = "Warm-up Baseline", expertiseLevel = "Baseline" }) {
    const [result] = await pool.query(
      `INSERT INTO interview_sessions
       (user_id, cv_id, target_company, job_role, expertise_level, session_type, session_number, status, total_questions, current_question_index)
       VALUES (?, NULL, ?, ?, ?, 'warmup', NULL, 'completed', 0, 0)`,
      [userId, targetCompany, jobRole, expertiseLevel]
    );
    return result.insertId;
  },

  async markWarmupSession(sessionId, userId) {
    const [result] = await pool.query(
      `UPDATE interview_sessions
       SET session_type = 'warmup', session_number = NULL, status = 'completed', completed_at = COALESCE(completed_at, NOW())
       WHERE id = ? AND user_id = ?`,
      [sessionId, userId]
    );
    return result.affectedRows > 0;
  },

  async insertSignals(sessionId, qaId, readings) {
    if (!readings.length) return 0;
    const values = readings.map((reading) => [
      sessionId,
      qaId || null,
      reading.t_sec,
      reading.source,
      JSON.stringify(reading.metrics),
    ]);

    const [result] = await pool.query(
      "INSERT INTO session_signals (session_id, qa_id, t_sec, source, metrics) VALUES ?",
      [values]
    );
    return result.affectedRows;
  },

  async getSignalsForSession(sessionId) {
    const [rows] = await pool.query(
      "SELECT * FROM session_signals WHERE session_id = ? ORDER BY t_sec ASC, id ASC",
      [sessionId]
    );
    return rows.map((row) => ({ ...row, metrics: safeJson(row.metrics, {}) }));
  },

  async getSignalsForSessions(sessionIds) {
    if (!sessionIds.length) return [];
    const [rows] = await pool.query(
      `SELECT * FROM session_signals WHERE session_id IN (${sessionIds.map(() => "?").join(",")}) ORDER BY session_id ASC, t_sec ASC`,
      sessionIds
    );
    return rows.map((row) => ({ ...row, metrics: safeJson(row.metrics, {}) }));
  },

  async getQALogsForSession(sessionId) {
    const [rows] = await pool.query(
      `SELECT q.*,
        TIMESTAMPDIFF(SECOND, s.created_at, q.created_at) AS question_start_sec,
        CASE WHEN q.answered_at IS NULL THEN NULL ELSE TIMESTAMPDIFF(SECOND, s.created_at, q.answered_at) END AS answer_end_sec
       FROM interview_qa_logs q
       JOIN interview_sessions s ON q.session_id = s.id
       WHERE q.session_id = ?
       ORDER BY q.question_number ASC`,
      [sessionId]
    );
    return rows;
  },

  async getInterviewSessionsForUser(userId) {
    const [rows] = await pool.query(
      `SELECT * FROM interview_sessions
       WHERE user_id = ? AND session_type <> 'warmup' AND status = 'completed'
       ORDER BY COALESCE(session_number, id) ASC, id ASC`,
      [userId]
    );
    return rows;
  },

  async getLatestBaseline(userId) {
    const [rows] = await pool.query(
      "SELECT * FROM user_baselines WHERE user_id = ? ORDER BY version DESC LIMIT 1",
      [userId]
    );
    if (!rows[0]) return null;
    return { ...rows[0], metrics: safeJson(rows[0].metrics, {}) };
  },

  async getNextBaselineVersion(userId) {
    const [rows] = await pool.query(
      "SELECT COALESCE(MAX(version), 0) + 1 AS nextVersion FROM user_baselines WHERE user_id = ?",
      [userId]
    );
    return rows[0]?.nextVersion || 1;
  },

  async saveBaseline({ userId, sessionId = null, metrics, confidence, source = "warmup" }) {
    const version = await this.getNextBaselineVersion(userId);
    const [result] = await pool.query(
      `INSERT INTO user_baselines (user_id, session_id, version, metrics, confidence, source)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, sessionId, version, JSON.stringify(metrics), confidence, source]
    );
    return {
      id: result.insertId,
      user_id: userId,
      session_id: sessionId,
      version,
      metrics,
      confidence,
      source,
    };
  },

  async getTipsForUser(userId, sessionId = null) {
    const params = [userId];
    let where = "WHERE user_id = ?";
    if (sessionId) {
      where += " AND session_id = ?";
      params.push(sessionId);
    }
    const [rows] = await pool.query(
      `SELECT * FROM coaching_tips ${where} ORDER BY created_at DESC`,
      params
    );
    return rows;
  },

  async insertCoachingTip(tip) {
    const [result] = await pool.query(
      `INSERT INTO coaching_tips
       (user_id, session_id, qa_id, question_type, metric, before_value, goal_text, tip, why, practice, approach_label, baseline_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tip.user_id,
        tip.session_id,
        tip.qa_id || null,
        tip.question_type || null,
        tip.metric,
        tip.before_value == null ? null : tip.before_value,
        tip.goal_text || null,
        tip.tip,
        tip.why || null,
        tip.practice || null,
        tip.approach_label || null,
        tip.baseline_version || null,
      ]
    );
    return result.insertId;
  },

  async patchTipFollowed(tipId, userId, followed) {
    const [result] = await pool.query(
      "UPDATE coaching_tips SET followed = ? WHERE id = ? AND user_id = ?",
      [followed, tipId, userId]
    );
    return result.affectedRows > 0;
  },

  async updateTipOutcome({ tipId, userId, afterValue, outcomeStatus }) {
    await pool.query(
      `UPDATE coaching_tips
       SET after_value = ?, outcome_status = ?, evaluated_at = NOW()
       WHERE id = ? AND user_id = ?`,
      [afterValue, outcomeStatus, tipId, userId]
    );
  },

  async upsertSelfRating({ userId, sessionId, improvementRating, tipClarityRating, tipUsefulnessRating, comment }) {
    await pool.query(
      `INSERT INTO self_ratings
       (user_id, session_id, improvement_rating, tip_clarity_rating, tip_usefulness_rating, comment)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        improvement_rating = VALUES(improvement_rating),
        tip_clarity_rating = VALUES(tip_clarity_rating),
        tip_usefulness_rating = VALUES(tip_usefulness_rating),
        comment = VALUES(comment)`,
      [userId, sessionId, improvementRating, tipClarityRating || null, tipUsefulnessRating || null, comment || null]
    );
  },

  async getSelfRatings(userId = null) {
    const [rows] = userId
      ? await pool.query("SELECT * FROM self_ratings WHERE user_id = ?", [userId])
      : await pool.query("SELECT * FROM self_ratings");
    return rows;
  },

  async insertDriftEvent(event) {
    await pool.query(
      `INSERT IGNORE INTO drift_events
       (user_id, metric, question_type, z_score, direction, classification, detected_at_session_number)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        event.user_id,
        event.metric,
        event.question_type || "overall",
        event.z_score,
        event.direction,
        event.classification,
        event.detected_at_session_number || null,
      ]
    );
  },

  async getEvaluationUsers(includeDemo = false) {
    const sql = includeDemo
      ? "SELECT id FROM users ORDER BY id ASC"
      : "SELECT id FROM users WHERE email NOT LIKE ? ORDER BY id ASC";
    const [rows] = includeDemo ? await pool.query(sql) : await pool.query(sql, ["%@demo.local"]);
    return rows.map((row) => row.id);
  },
};

module.exports = C3Model;
