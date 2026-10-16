// MANUAL DEMO-ONLY EXCEPTION: this script inserts shared rows for its own demo users.
// It is never imported by server startup or the observer.
const { pool } = require("../../config/db");
const bcrypt = require("bcryptjs");
const store = require("../models/store");
const { initC3 } = require("../db/initC3");
const { buildBaselineMetrics } = require("../services/analytics");
const personas = ["improving", "shifting", "declining", "flat", "improving2"];
const marker = "C3 Sidecar Demo";
const emailFor = (persona) => `c3.sidecar.${persona}@demo.local`;
const metricFor = (persona, n) => persona.startsWith("improving") ? 0.7 - n * 0.065 :
  persona === "declining" ? 0.24 + n * 0.065 : persona === "shifting" ? (n < 4 ? 0.3 : 0.65) : 0.3;

async function seed(remove = false) {
  if (!await initC3()) throw new Error("C3 tables unavailable");
  const hash = remove ? null : await bcrypt.hash("C3demo12345!", 10);
  for (const [index, persona] of personas.entries()) {
    const email = emailFor(persona);
    const [existing] = await pool.query("SELECT id, first_name FROM users WHERE email = ?", [email]);
    if (existing[0] && existing[0].first_name !== marker) throw new Error("Reserved demo identity already exists; refusing to modify it");
    if (remove) {
      if (existing[0]) await pool.query("DELETE FROM users WHERE id = ? AND email = ? AND first_name = ?", [existing[0].id, email, marker]);
      continue;
    }
    let userId = existing[0]?.id;
    if (!userId) {
      const [user] = await pool.query(`INSERT INTO users (first_name, last_name, email, mobile_contact_number, nic, password, role)
        VALUES (?, ?, ?, ?, ?, ?, 'user')`, [marker, persona, email, `079880000${index}`, `C3-SIDECAR-${index}`, hash]);
      userId = user.insertId;
    }
    const [warmups] = await pool.query("SELECT id FROM c3_session_meta WHERE user_id = ? AND session_type = 'warmup' ORDER BY id LIMIT 1", [userId]);
    const warmupId = warmups.length ? -warmups[0].id : await store.createWarmupSession({ userId });
    if (!(await store.getSignalsForSession(warmupId)).length) await store.insertSignals(warmupId, null,
      Array.from({ length: 12 }, (_, i) => ({ t_sec: i * 3, source: "face", metrics: { gaze_off: 0.28 + (i % 3) * 0.02 }, model_name: "synthetic-demo" })));
    if (!await store.getLatestBaseline(userId)) {
      const baseline = buildBaselineMetrics(await store.getSignalsForSession(warmupId));
      await store.saveBaseline({ userId, sessionId: warmupId, ...baseline, source: "synthetic_demo_warmup" });
    }
    for (let n = 1; n <= 6; n++) {
      const createdAt = new Date(Date.now() - (7 - n) * 86400000);
      const [known] = await pool.query("SELECT session_id FROM c3_session_meta WHERE user_id = ? AND session_number = ?", [userId, n]);
      let sessionId = known[0]?.session_id;
      if (!sessionId) {
        const sharedSessions = await store.reader.sessions(userId);
        sessionId = sharedSessions[n - 1]?.id;
      }
      if (!sessionId) {
        const [session] = await pool.query(`INSERT INTO interview_sessions
          (user_id, job_role, expertise_level, status, total_questions, current_question_index, created_at, completed_at)
          VALUES (?, 'Demo IT Graduate', 'Graduate', 'completed', 4, 4, ?, ?)`, [userId, createdAt, new Date(+createdAt + 240000)]);
        sessionId = session.insertId;
        await store.ensureSession(sessionId, userId, true);
      }
      await store.ensureSession(sessionId, userId, true);
      for (const [qi, type] of ["hr", "technical", "behavioral", "situational"].entries()) {
        const [knownQuestion] = await pool.query("SELECT id FROM interview_qa_logs WHERE session_id = ? AND question_number = ?", [sessionId, qi + 1]);
        let qaId = knownQuestion[0]?.id;
        if (!qaId) {
          const [qa] = await pool.query(`INSERT INTO interview_qa_logs (session_id, question_number, question_text, user_answer_text, created_at)
            VALUES (?, ?, ?, ?, ?)`, [sessionId, qi + 1, `Synthetic ${type} question ${qi + 1}`, "This is a synthetic demo answer with a concrete example and result.", new Date(+createdAt + qi * 60000)]);
          qaId = qa.insertId;
        }
        await store.recordEvent(sessionId, qaId, "question_delivered", new Date(+createdAt + qi * 60000));
        await store.recordEvent(sessionId, qaId, "answer_received", new Date(+createdAt + qi * 60000 + 45000));
        const score = persona.startsWith("improving") ? 48 + n * 6 : persona === "declining" ? 90 - n * 6 : 70;
        await store.saveAnswerMeta({ sessionId, qaId, questionType: type, wordCount: 14, latency: 45, score, scoreSource: "synthetic_demo" });
        const [signalCount] = await pool.query("SELECT COUNT(*) AS n FROM c3_signals WHERE session_id = ? AND qa_id = ?", [sessionId, qaId]);
        if (!signalCount[0].n) await store.insertSignals(sessionId, qaId, [1, 2, 3, 4].map((i) => ({ t_sec: qi * 60 + i * 5, source: "face",
          metrics: { gaze_off: metricFor(persona, n) + (i % 2) * 0.01 }, model_name: "synthetic-demo" })));
      }
      await store.upsertSelfRating({ userId, sessionId, improvementRating: persona.startsWith("improving") ? Math.min(5, n) : persona === "declining" ? Math.max(1, 6 - n) : 3,
        tipClarityRating: 4, tipUsefulnessRating: 4, comment: "Synthetic demo rating; not research evidence." });
      if (!(await store.getTipsForUser(userId, sessionId)).length) {
        const baseline = await store.getLatestBaseline(userId);
        const deviation = Math.abs((metricFor(persona, n) - baseline.metrics.gaze_off.mean) / baseline.metrics.gaze_off.std);
        const tipId = await store.insertCoachingTip({ user_id: userId, session_id: sessionId, metric: "gaze_off", before_value: deviation,
          baseline_version: baseline.version, tip: "Synthetic demo: place notes near the camera.", why: "Synthetic delivery deviation for demonstration only.",
          practice: "Rehearse a short answer with your notes near the camera.", approach_label: "synthetic_demo" });
        await store.patchTipFollowed(tipId, userId, n % 2 ? "yes" : "partly");
        if (n < 6) {
          const after = Math.abs((metricFor(persona, n + 1) - baseline.metrics.gaze_off.mean) / baseline.metrics.gaze_off.std);
          await store.updateTipOutcome({ tipId, userId, afterValue: after, outcomeStatus: require("../services/coaching").evaluateOutcome(deviation, after) });
        }
      }
    }
    await require("../services/progress").detectDrift(userId);
  }
  return personas.length;
}
module.exports = { seed, personas };
if (require.main === module) seed(process.argv.includes("--delete"))
  .then((count) => console.log(`C3 demo ${process.argv.includes("--delete") ? "cleanup" : "seed"} complete for ${count} reserved identities.`))
  .catch(() => { console.error("C3 demo operation incomplete; inspect your local DB configuration and retry."); process.exitCode = 1; })
  .finally(() => pool.end());
