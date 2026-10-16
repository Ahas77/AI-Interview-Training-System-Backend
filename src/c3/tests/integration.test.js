const test = require("node:test");
const assert = require("node:assert/strict");

// Opt-in only: the normal unit suite requires no running database.
test("real MySQL/API sidecar lifecycle in a disposable database", { skip: process.env.C3_INTEGRATION !== "1" }, async (t) => {
  require("dotenv").config({ quiet: true });
  const mysql = require("mysql2/promise");
  const express = require("express");
  const jwt = require("jsonwebtoken");
  const database = `c3_sidecar_verify_${Date.now()}`;
  process.env.DB_NAME = database;
  assert.match(database, /^c3_sidecar_verify_\d+$/);
  const { pool, initDB } = require("../../config/db");
  const { initC3 } = require("../db/initC3");
  const observer = require("../middleware/observer");
  const { verifyToken } = require("../../middleware/authMiddleware");
  const store = require("../models/store");
  const provider = require("../../services/ai/aiProvider");
  t.mock.method(provider, "generateJSON", async () => JSON.stringify({ tip: "Put your notes near the camera.", why: "Provided evidence", practice: "Rehearse a short answer.", approach_label: "notes_near_camera" }));
  let server;
  try {
    await initDB();
    const [before] = await pool.query("SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('users','cv_analysis','interview_sessions','interview_qa_logs') ORDER BY TABLE_NAME, ORDINAL_POSITION", [database]);
    assert.equal(await initC3(), true);
    assert.equal(await initC3(), true);
    const [after] = await pool.query("SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('users','cv_analysis','interview_sessions','interview_qa_logs') ORDER BY TABLE_NAME, ORDINAL_POSITION", [database]);
    assert.deepEqual(after, before);
    const [user] = await pool.query("INSERT INTO users (first_name,last_name,email,mobile_contact_number,nic,password,role) VALUES ('Disposable','C3','c3-test@example.invalid','0799999999','C3-TEST-ONLY','not-a-real-password','user')");
    const token = jwt.sign({ id: user.insertId, role: "user" }, process.env.JWT_SECRET || "default_secret_key");
    const otherToken = jwt.sign({ id: user.insertId + 999, role: "user" }, process.env.JWT_SECRET || "default_secret_key");
    const extraObserver = require("../middleware/observer").createObserver({ observedRoutes: [{
      method: "POST", pattern: /^\/api\/component-score$/, handler: "answerScore",
      fields: { session: ["request.body.sessionId"], qa: ["request.body.qaId"], score: ["response.data.score"], type: ["response.data.type"], scoreSource: "test_component" },
    }] });
    const app = express(); app.use(express.json()); app.use(observer); app.use(extraObserver);
    app.post("/api/component-score", verifyToken, (_req, res) => res.json({ success: true, data: { score: 65, type: "technical" } }));
    app.post("/api/interview/start", verifyToken, async (req, res) => {
      const [session] = await pool.query("INSERT INTO interview_sessions (user_id,job_role,expertise_level) VALUES (?,'Test IT','Graduate')", [req.user.id]);
      const [qa] = await pool.query("INSERT INTO interview_qa_logs (session_id,question_number,question_text) VALUES (?,1,'Tell me about a project')", [session.insertId]);
      res.json({ success: true, sessionId: session.insertId, currentQuestion: { id: qa.insertId } });
    });
    app.post("/api/interview/submit-answer", verifyToken, async (req, res) => {
      await pool.query("UPDATE interview_qa_logs SET user_answer_text = ? WHERE id = ? AND session_id = ?", [req.body.userAnswerText, req.body.qaId, req.body.sessionId]);
      await pool.query("UPDATE interview_sessions SET status = 'completed', completed_at = NOW() WHERE id = ?", [req.body.sessionId]);
      res.json({ success: true, isCompleted: true });
    });
    app.use("/api/c3", require("../routes"));
    server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const request = async (path, body, auth = token) => {
      const response = await fetch(url + path, { method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    };
    const started = await request("/api/interview/start", {}); await observer.drain();
    assert.equal(started.status, 200);
    const { sessionId, currentQuestion } = started.body;
    await request("/api/interview/submit-answer", { sessionId, qaId: currentQuestion.id, userAnswerText: "I built a sample project" }); await observer.drain();
    const [answer] = await pool.query("SELECT answer_word_count,response_latency_sec FROM c3_answer_meta WHERE qa_id = ?", [currentQuestion.id]);
    assert.equal(answer[0].answer_word_count, 5); assert.ok(answer[0].response_latency_sec >= 0);
    const scoring = await request("/api/component-score", { sessionId, qaId: currentQuestion.id });
    assert.equal(scoring.body.data.score, 65); await extraObserver.drain();
    const [scored] = await pool.query("SELECT answer_score,score_source,question_type FROM c3_answer_meta WHERE qa_id = ?", [currentQuestion.id]);
    assert.equal(scored[0].answer_score, 65); assert.equal(scored[0].score_source, "test_component"); assert.equal(scored[0].question_type, "technical");
    const warmup = await request("/api/c3/warmup", {}); const warmupId = warmup.body.data.sessionId;
    assert.ok(warmupId < 0);
    const [sharedCount] = await pool.query("SELECT COUNT(*) AS n FROM interview_sessions"); assert.equal(sharedCount[0].n, 1);
    const readings = [1, 2, 3].map((time) => ({ t_sec: time, source: "face", metrics: { gaze_off: 0.2 } }));
    assert.equal((await request("/api/c3/signals", { sessionId: warmupId, readings })).status, 201);
    assert.equal((await request("/api/c3/baseline/build", { sessionId: warmupId })).status, 201);
    assert.equal((await request("/api/c3/signals", { sessionId, qaId: currentQuestion.id, readings: readings.map((r) => ({ ...r, metrics: { gaze_off: 0.6 } })) })).status, 201);
    const detail = await request(`/api/c3/session/${sessionId}`);
    assert.equal(detail.body.data.summaries[0].metrics.gaze_off.deviation, 8);
    assert.equal((await request(`/api/c3/session/${sessionId}`, undefined, otherToken)).status, 404);
    assert.equal((await request("/api/c3/baseline/refresh", {})).status, 422);
    assert.equal((await request("/api/c3/evaluation/dataset")).status, 403);
    const coaching = await request(`/api/c3/coaching/${sessionId}/generate`, {});
    assert.equal(coaching.status, 201); assert.ok(coaching.body.data.tips.length > 0);
    const rating = await request("/api/c3/self-rating", { sessionId, improvementRating: 4 }); assert.equal(rating.status, 200);
    assert.equal((await store.getSelfRatings(user.insertId)).length, 1);
    const countBefore = (await store.getQALogsForSession(sessionId))[0].answer_word_count;
    await require("../scripts/backfill").backfill(); await require("../scripts/backfill").backfill();
    assert.equal((await store.getQALogsForSession(sessionId))[0].answer_word_count, countBefore);
    assert.equal((await store.getQALogsForSession(sessionId))[0].question_type, "technical");
    const [sessionCount] = await pool.query("SELECT COUNT(*) AS n FROM c3_session_meta WHERE session_id = ?", [sessionId]); assert.equal(sessionCount[0].n, 1);
    const adminToken = jwt.sign({ id: user.insertId, role: "admin" }, process.env.JWT_SECRET || "default_secret_key");
    const dataset = await request("/api/c3/evaluation/dataset", undefined, adminToken);
    assert.equal(dataset.status, 200); assert.match(dataset.body.data[0].user_id, /^user_[a-f0-9]+$/);
    // Explicit test invocation of the standalone seed, confined to this disposable database.
    const { seed } = require("../scripts/seed");
    await seed(); await seed();
    const [demoCounts] = await pool.query("SELECT COUNT(*) AS n FROM interview_sessions WHERE user_id <> ?", [user.insertId]);
    assert.equal(demoCounts[0].n, 30);
    const withDemo = await request("/api/c3/evaluation/dataset?includeDemo=true", undefined, adminToken);
    assert.equal(withDemo.body.data.length, 31);
    assert.equal((await request("/api/c3/evaluation/dataset", undefined, adminToken)).body.data.length, 1);
    const corr = await request("/api/c3/evaluation/correlation?includeDemo=true", undefined, adminToken);
    assert.equal(corr.body.data.status, "ready"); assert.equal(corr.body.data.participant_count, 5);
    await seed(true);
    const [remaining] = await pool.query("SELECT COUNT(*) AS n FROM users"); assert.equal(remaining[0].n, 1);
    // Boot the actual entry point with the observer both enabled and disabled.
    const { spawn } = require("node:child_process");
    const net = require("node:net");
    for (const flag of ["on", "off"]) {
      const reservation = net.createServer(); reservation.listen(0, "127.0.0.1");
      await new Promise((resolve) => reservation.once("listening", resolve));
      const port = reservation.address().port; await new Promise((resolve) => reservation.close(resolve));
      const child = spawn(process.execPath, ["index.js"], { cwd: require("node:path").resolve(__dirname, "../../.."),
        env: { ...process.env, PORT: String(port), C3_OBSERVER: flag }, stdio: ["ignore", "pipe", "pipe"] });
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Server boot timeout")), 8000);
          child.on("error", (error) => { clearTimeout(timeout); reject(error); });
          child.stdout.on("data", (chunk) => { if (chunk.toString().includes("Server running")) { clearTimeout(timeout); resolve(); } });
        });
        const health = await fetch(`http://127.0.0.1:${port}/`);
        assert.equal((await health.json()).status, "ok");
      } finally { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); }
    }
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
    // Only this freshly generated test database can be dropped.
    assert.match(database, /^c3_sidecar_verify_\d+$/);
    const admin = await mysql.createConnection({ host: process.env.DB_HOST || "localhost", user: process.env.DB_USER || "root", password: process.env.DB_PASSWORD || "", port: Number(process.env.DB_PORT || 3306) });
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``); await admin.end();
  }
});
