const { pool } = require("../../config/db");
const { safeJson, wordCount } = require("../services/analytics");
const { createReader } = require("./sharedReader");
const { DB_RETRIES } = require("../config/thresholds");
const reader = createReader(pool);
const store = {
  reader,
  async ensureSession(sessionId, userId, completed = false) {
    const shared = await reader.session(sessionId, userId);
    if (!shared) return null;
    for (let attempt = 0; attempt < DB_RETRIES; attempt++) {
      const [existing] = await pool.query("SELECT id, session_number FROM c3_session_meta WHERE session_id = ? AND user_id = ?", [sessionId, userId]);
      if (existing.length) {
        if (completed || shared.status === "completed") await pool.query("UPDATE c3_session_meta SET completed_at = COALESCE(completed_at, ?) WHERE session_id = ? AND user_id = ?", [shared.completed_at || new Date(), sessionId, userId]);
        return existing[0];
      }
      const [number] = await pool.query("SELECT COALESCE(MAX(session_number), 0) + 1 AS n FROM c3_session_meta WHERE user_id = ?", [userId]);
      try {
        const [result] = await pool.query("INSERT INTO c3_session_meta (session_id, user_id, session_type, session_number, completed_at, created_at) VALUES (?, ?, 'interview', ?, ?, ?)",
          [sessionId, userId, number[0].n, completed || shared.status === "completed" ? shared.completed_at || new Date() : null, shared.created_at || new Date()]);
        return { id: result.insertId, session_number: number[0].n };
      } catch (error) { if (error.code !== "ER_DUP_ENTRY") throw error; }
    }
    throw new Error("C3 session numbering busy");
  },
  async getSessionForUser(sessionId, userId) {
    if (sessionId < 0) {
      const [rows] = await pool.query("SELECT id, user_id, session_type, created_at, completed_at FROM c3_session_meta WHERE id = ? AND user_id = ? AND session_type = 'warmup'", [-sessionId, userId]);
      return rows[0] ? { ...rows[0], id: sessionId, status: "completed", session_number: null, job_role: "Warm-up Baseline", expertise_level: "Baseline" } : null;
    }
    const session = await reader.session(sessionId, userId);
    if (!session) return null;
    const [meta] = await pool.query("SELECT session_number, completed_at FROM c3_session_meta WHERE session_id = ? AND user_id = ?", [sessionId, userId]);
    return { ...session, session_number: meta[0]?.session_number || null, session_type: session.session_type || "interview", status: meta[0]?.completed_at ? "completed" : session.status };
  },
  async getInterviewSessionsForUser(userId) {
    const sessions = await reader.sessions(userId);
    const [metas] = await pool.query("SELECT session_id, session_number, completed_at FROM c3_session_meta WHERE user_id = ? AND session_type = 'interview'", [userId]);
    const byId = new Map(metas.map((row) => [row.session_id, row]));
    return sessions.filter((row) => row.session_type !== "warmup" && byId.has(row.id))
      .map((row) => ({ ...row, session_number: byId.get(row.id).session_number, status: byId.get(row.id).completed_at ? "completed" : row.status }))
      .filter((row) => row.status === "completed").sort((a, b) => a.session_number - b.session_number);
  },
  async createWarmupSession({ userId }) {
    const [result] = await pool.query("INSERT INTO c3_session_meta (user_id, session_type) VALUES (?, 'warmup')", [userId]);
    return -result.insertId;
  },
  async insertSignals(sessionId, qaId, readings) {
    if (!readings.length) return 0;
    const values = readings.map((reading) => [sessionId > 0 ? sessionId : null, sessionId < 0 ? -sessionId : null, qaId || null,
      reading.t_sec, reading.source, JSON.stringify(reading.metrics), reading.model_name || null, reading.model_version || null, reading.confidence ?? null]);
    const [result] = await pool.query("INSERT INTO c3_signals (session_id, warmup_id, qa_id, t_sec, source, metrics, model_name, model_version, confidence) VALUES ?", [values]);
    return result.affectedRows;
  },
  async getSignalsForSession(sessionId) {
    const sql = sessionId < 0 ? "SELECT qa_id, t_sec, source, metrics FROM c3_signals WHERE warmup_id = ? ORDER BY t_sec, id" :
      "SELECT qa_id, t_sec, source, metrics FROM c3_signals WHERE session_id = ? ORDER BY t_sec, id";
    const [rows] = await pool.query(sql, [Math.abs(sessionId)]);
    return rows.map((row) => ({ ...row, metrics: safeJson(row.metrics, {}) }));
  },
  async getSignalsForSessions(ids) { return (await Promise.all(ids.map((id) => this.getSignalsForSession(id)))).flat(); },
  async getQALogsForSession(sessionId) {
    if (sessionId < 0) return [];
    const questions = await reader.questions(sessionId);
    const shared = await reader.session(sessionId);
    const [metas] = await pool.query("SELECT qa_id, question_type, answer_word_count, response_latency_sec, answer_score FROM c3_answer_meta WHERE session_id = ?", [sessionId]);
    const [events] = await pool.query("SELECT qa_id, event, occurred_at FROM c3_question_events WHERE session_id = ?", [sessionId]);
    return questions.map((q) => {
      const meta = metas.find((row) => row.qa_id === q.id);
      const delivered = events.find((row) => row.qa_id === q.id && row.event === "question_delivered")?.occurred_at || q.created_at;
      const answered = events.find((row) => row.qa_id === q.id && row.event === "answer_received")?.occurred_at || q.answered_at;
      const relative = (date) => date && shared?.created_at ? Math.max(0, (new Date(date) - new Date(shared.created_at)) / 1000) : null;
      return { ...q, question_type: meta?.question_type || q.question_type || "hr", answer_score: meta?.answer_score ?? q.answer_score ?? null,
        answer_word_count: meta?.answer_word_count ?? wordCount(q.user_answer_text), response_latency_sec: meta?.response_latency_sec ?? null,
        question_start_sec: relative(delivered), answer_end_sec: relative(answered), answered_at: answered };
    });
  },
  async recordEvent(sessionId, qaId, event, occurredAt) {
    await pool.query("INSERT IGNORE INTO c3_question_events (session_id, qa_id, event, occurred_at) VALUES (?, ?, ?, ?)", [sessionId, qaId, event, occurredAt]);
  },
  async saveAnswerMeta({ sessionId, qaId, questionType = null, wordCount: words = null, latency = null, score = null, scoreSource = null, preserve = false }) {
    if (preserve) {
      await pool.query(`INSERT INTO c3_answer_meta (qa_id, session_id, question_type, answer_word_count, response_latency_sec, answer_score, score_source)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE
        question_type = IF(question_type = 'hr', VALUES(question_type), question_type),
        answer_word_count = COALESCE(answer_word_count, VALUES(answer_word_count)),
        response_latency_sec = COALESCE(response_latency_sec, VALUES(response_latency_sec)),
        answer_score = COALESCE(answer_score, VALUES(answer_score)), score_source = COALESCE(score_source, VALUES(score_source))`,
        [qaId, sessionId, questionType || "hr", words, latency, score, scoreSource]);
      return;
    }
    await pool.query(`INSERT INTO c3_answer_meta (qa_id, session_id, question_type, answer_word_count, response_latency_sec, answer_score, score_source)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE
      question_type = COALESCE(?, question_type), answer_word_count = COALESCE(?, answer_word_count),
      response_latency_sec = COALESCE(?, response_latency_sec), answer_score = COALESCE(?, answer_score), score_source = COALESCE(?, score_source)`,
      [qaId, sessionId, questionType || "hr", words, latency, score, scoreSource, questionType, words, latency, score, scoreSource]);
  },
  async getEvaluationUsers(includeDemo = false) {
    const users = await reader.users();
    return users.filter((user) => includeDemo || (typeof user.email === "string" && !user.email.endsWith("@demo.local"))).map((row) => row.id);
  },
  async getLatestBaseline(userId) {
    const [rows] = await pool.query(
      "SELECT * FROM c3_user_baselines WHERE user_id = ? ORDER BY version DESC LIMIT 1",
      [userId]
    );
    if (!rows[0]) return null;
    return { ...rows[0], metrics: safeJson(rows[0].metrics, {}) };
  },

  async getNextBaselineVersion(userId) {
    const [rows] = await pool.query(
      "SELECT COALESCE(MAX(version), 0) + 1 AS nextVersion FROM c3_user_baselines WHERE user_id = ?",
      [userId]
    );
    return rows[0]?.nextVersion || 1;
  },

  async saveBaseline({ userId, sessionId = null, metrics, confidence, source = "warmup" }) {
    for (let attempt = 0; attempt < DB_RETRIES; attempt++) {
      const version = await this.getNextBaselineVersion(userId);
      try {
        const [result] = await pool.query(`INSERT INTO c3_user_baselines (user_id, session_id, warmup_id, version, metrics, confidence, source) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [userId, sessionId > 0 ? sessionId : null, sessionId < 0 ? -sessionId : null, version, JSON.stringify(metrics), confidence, source]);
        return { id: result.insertId, user_id: userId, session_id: sessionId, version, metrics, confidence, source };
      } catch (error) { if (error.code !== "ER_DUP_ENTRY") throw error; }
    }
    throw new Error("C3 baseline version busy");
  },

  async getTipsForUser(userId, sessionId = null) {
    const params = [userId];
    let where = "WHERE user_id = ?";
    if (sessionId) {
      where += " AND session_id = ?";
      params.push(sessionId);
    }
    const [rows] = await pool.query(
      `SELECT * FROM c3_coaching_tips ${where} ORDER BY created_at DESC`,
      params
    );
    return rows.map((row) => ({ ...row, question_type: row.question_type === "overall" ? null : row.question_type }));
  },

  async insertCoachingTip(tip) {
    const [result] = await pool.query(
      `INSERT INTO c3_coaching_tips
       (user_id, session_id, qa_id, question_type, metric, before_value, goal_text, tip, why, practice, approach_label, baseline_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tip.user_id,
        tip.session_id,
        tip.qa_id || null,
        tip.question_type || "overall",
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
      "UPDATE c3_coaching_tips SET followed = ? WHERE id = ? AND user_id = ?",
      [followed, tipId, userId]
    );
    return result.affectedRows > 0;
  },

  async updateTipOutcome({ tipId, userId, afterValue, outcomeStatus }) {
    await pool.query(
      `UPDATE c3_coaching_tips
       SET after_value = ?, outcome_status = ?, evaluated_at = NOW()
       WHERE id = ? AND user_id = ?`,
      [afterValue, outcomeStatus, tipId, userId]
    );
  },

  async upsertSelfRating({ userId, sessionId, improvementRating, tipClarityRating, tipUsefulnessRating, comment }) {
    await pool.query(
      `INSERT INTO c3_self_ratings
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
      ? await pool.query("SELECT * FROM c3_self_ratings WHERE user_id = ?", [userId])
      : await pool.query("SELECT * FROM c3_self_ratings");
    return rows;
  },

  async insertDriftEvent(event) {
    await pool.query(
      `INSERT IGNORE INTO c3_drift_events
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

};
module.exports = store;
