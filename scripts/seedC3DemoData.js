require("dotenv").config();

const bcrypt = require("bcryptjs");
const { initDB, pool } = require("../src/config/db");
const { buildBaselineMetrics } = require("../src/services/c3AnalyticsService");

const deleteMode = process.argv.includes("--delete");
const password = "demo12345";

const personas = [
  { label: "improves", first: "Demo", last: "User 1", email: "demo.user1@demo.local" },
  { label: "drifts", first: "Demo", last: "User 2", email: "demo.user2@demo.local" },
  { label: "declines", first: "Demo", last: "User 3", email: "demo.user3@demo.local" },
  { label: "flat", first: "Demo", last: "User 4", email: "demo.user4@demo.local" },
];

const questionTypes = ["hr", "technical", "behavioural", "english"];
const metricNames = ["tension", "gaze_off", "smile", "pace", "pause_ratio", "energy"];

function sqlDate(daysOffset, minutesOffset = 0) {
  const date = new Date(Date.now() - (30 - daysOffset) * 24 * 60 * 60 * 1000 + minutesOffset * 60 * 1000);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function clamp(value) {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function metricValue(persona, sessionNumber, metricIndex, questionIndex) {
  const base = 0.42 + metricIndex * 0.035 + questionIndex * 0.01;
  if (persona === "improves") return clamp(base + (7 - sessionNumber) * 0.025);
  if (persona === "drifts") return clamp(base + (metricIndex % 2 === 0 ? sessionNumber * 0.025 : -sessionNumber * 0.01));
  if (persona === "declines") return clamp(base + sessionNumber * 0.03);
  return clamp(base + (questionIndex % 2) * 0.01);
}

function answerScore(persona, sessionNumber, questionIndex) {
  const base = 62 + questionIndex * 2;
  if (persona === "improves") return Math.min(92, base + sessionNumber * 4);
  if (persona === "declines") return Math.max(35, base - sessionNumber * 3);
  return base + (persona === "flat" ? 1 : 0);
}

async function deleteSeedData() {
  const [rows] = await pool.query("SELECT id FROM users WHERE email LIKE ?", ["%@demo.local"]);
  if (!rows.length) {
    console.log("No C3 demo users found.");
    return;
  }
  await pool.query("DELETE FROM users WHERE email LIKE ?", ["%@demo.local"]);
  console.log(`Deleted ${rows.length} C3 demo users and cascaded data.`);
}

async function createUser(persona, index) {
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users
     (first_name, last_name, email, mobile_contact_number, nic, address, date_of_birth, gender, password, role)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'user')
     ON DUPLICATE KEY UPDATE password = VALUES(password), first_name = VALUES(first_name), last_name = VALUES(last_name)`,
    [
      persona.first,
      persona.last,
      persona.email,
      `072000000${index}`,
      `DEMO-C3-${index}`,
      "Demo Address",
      "2000-01-01",
      index % 2 === 0 ? "Female" : "Male",
      hash,
    ]
  );
  const [rows] = await pool.query("SELECT id FROM users WHERE email = ? LIMIT 1", [persona.email]);
  return rows[0].id;
}

async function insertWarmup(userId, persona, userIndex) {
  const createdAt = sqlDate(userIndex);
  const [sessionResult] = await pool.query(
    `INSERT INTO interview_sessions
     (user_id, job_role, expertise_level, session_type, session_number, status, total_questions, current_question_index, created_at, completed_at)
     VALUES (?, 'Warm-up Baseline', 'Baseline', 'warmup', NULL, 'completed', 0, 0, ?, ?)`,
    [userId, createdAt, createdAt]
  );
  const sessionId = sessionResult.insertId;
  const signalRows = [];
  for (let i = 0; i < 12; i++) {
    const metrics = {};
    metricNames.forEach((metric, metricIndex) => {
      metrics[metric] = clamp(0.42 + metricIndex * 0.03 + i * 0.002);
    });
    signalRows.push([sessionId, null, i * 2, "face", JSON.stringify(metrics), createdAt]);
  }
  await pool.query(
    "INSERT INTO session_signals (session_id, qa_id, t_sec, source, metrics, created_at) VALUES ?",
    [signalRows]
  );
  const baseline = buildBaselineMetrics(signalRows.map((row) => ({ metrics: JSON.parse(row[4]) })));
  await pool.query(
    "INSERT INTO user_baselines (user_id, session_id, version, metrics, confidence, source, created_at) VALUES (?, ?, 1, ?, ?, 'warmup', ?)",
    [userId, sessionId, JSON.stringify(baseline.metrics), baseline.confidence, createdAt]
  );
}

async function insertInterview(userId, persona, userIndex, sessionNumber) {
  const createdAt = sqlDate(userIndex + sessionNumber, sessionNumber * 15);
  const [sessionResult] = await pool.query(
    `INSERT INTO interview_sessions
     (user_id, job_role, expertise_level, session_type, session_number, status, total_questions, current_question_index, created_at, completed_at)
     VALUES (?, 'Software Engineer', 'Intermediate', 'interview', ?, 'completed', 4, 4, ?, DATE_ADD(?, INTERVAL 20 MINUTE))`,
    [userId, sessionNumber, createdAt, createdAt]
  );
  const sessionId = sessionResult.insertId;

  let questionStart = 30;
  for (let q = 0; q < 4; q++) {
    const latency = persona.label === "improves" ? 80 - sessionNumber * 4 : persona.label === "declines" ? 55 + sessionNumber * 6 : 65;
    const answeredAt = `DATE_ADD(?, INTERVAL ${questionStart + latency} SECOND)`;
    const [qaResult] = await pool.query(
      `INSERT INTO interview_qa_logs
       (session_id, question_number, question_type, question_text, user_answer_text, answered_at, answer_word_count, answer_score, response_latency_sec, created_at)
       VALUES (?, ?, ?, ?, ?, ${answeredAt}, ?, ?, ?, DATE_ADD(?, INTERVAL ${questionStart} SECOND))`,
      [
        sessionId,
        q + 1,
        questionTypes[q],
        `Demo ${questionTypes[q]} question ${q + 1}`,
        `This is a realistic demo answer for ${questionTypes[q]} question ${q + 1} in session ${sessionNumber}.`,
        createdAt,
        14,
        answerScore(persona.label, sessionNumber, q),
        latency,
        createdAt,
      ]
    );
    const qaId = qaResult.insertId;
    const signals = [];
    for (let t = 0; t <= latency; t += 2) {
      const metrics = {};
      metricNames.forEach((metric, metricIndex) => {
        metrics[metric] = metricValue(persona.label, sessionNumber, metricIndex, q);
      });
      signals.push([sessionId, qaId, questionStart + t, "face", JSON.stringify(metrics), createdAt]);
    }
    await pool.query(
      "INSERT INTO session_signals (session_id, qa_id, t_sec, source, metrics, created_at) VALUES ?",
      [signals]
    );
    questionStart += latency + 45;
  }

  await pool.query(
    `INSERT INTO self_ratings (user_id, session_id, improvement_rating, tip_clarity_rating, tip_usefulness_rating, comment, created_at)
     VALUES (?, ?, ?, 4, 4, ?, ?)`,
    [
      userId,
      sessionId,
      persona.label === "improves" ? Math.min(5, 2 + Math.ceil(sessionNumber / 2)) : persona.label === "declines" ? Math.max(1, 4 - Math.floor(sessionNumber / 2)) : 3,
      `Seeded ${persona.label} pattern`,
      createdAt,
    ]
  );
}

async function seed() {
  await initDB();
  if (deleteMode) {
    await deleteSeedData();
    return;
  }

  await deleteSeedData();
  for (let i = 0; i < personas.length; i++) {
    const userId = await createUser(personas[i], i + 1);
    await insertWarmup(userId, personas[i], i + 1);
    for (let sessionNumber = 1; sessionNumber <= 6; sessionNumber++) {
      await insertInterview(userId, personas[i], i + 1, sessionNumber);
    }
    console.log(`Seeded ${personas[i].email} / ${password} (${personas[i].label})`);
  }
}

seed()
  .then(async () => {
    await pool.end();
    console.log("C3 demo seeding complete.");
  })
  .catch(async (error) => {
    console.error("C3 demo seeding failed:", error);
    await pool.end();
    process.exit(1);
  });
