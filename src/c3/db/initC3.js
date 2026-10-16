const statements = [
  `CREATE TABLE IF NOT EXISTS c3_session_meta (
    id INT AUTO_INCREMENT PRIMARY KEY, session_id INT NULL UNIQUE, user_id INT NOT NULL,
    session_type VARCHAR(20) NOT NULL DEFAULT 'interview', session_number INT NULL,
    completed_at DATETIME(3) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY c3_session_number (user_id, session_number),
    FOREIGN KEY (session_id) REFERENCES interview_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS c3_question_events (
    id INT AUTO_INCREMENT PRIMARY KEY, session_id INT NOT NULL, qa_id INT NULL,
    event VARCHAR(30) NOT NULL, occurred_at DATETIME(3) NOT NULL,
    UNIQUE KEY c3_question_event (session_id, qa_id, event),
    FOREIGN KEY (session_id) REFERENCES interview_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (qa_id) REFERENCES interview_qa_logs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS c3_answer_meta (
    qa_id INT PRIMARY KEY, session_id INT NOT NULL, question_type VARCHAR(50) NOT NULL DEFAULT 'hr',
    answer_word_count INT NULL, response_latency_sec DOUBLE NULL,
    answer_score DOUBLE NULL, score_source VARCHAR(80) NULL,
    FOREIGN KEY (qa_id) REFERENCES interview_qa_logs(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES interview_sessions(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS c3_signals (
    id INT AUTO_INCREMENT PRIMARY KEY, session_id INT NULL, warmup_id INT NULL, qa_id INT NULL,
    t_sec DOUBLE NOT NULL, source VARCHAR(20) NOT NULL, metrics JSON NOT NULL,
    model_name VARCHAR(80) NULL, model_version VARCHAR(80) NULL, confidence DOUBLE NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CHECK ((session_id IS NOT NULL) <> (warmup_id IS NOT NULL)),
    INDEX c3_signal_session (session_id, t_sec), INDEX c3_signal_warmup (warmup_id),
    FOREIGN KEY (session_id) REFERENCES interview_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (warmup_id) REFERENCES c3_session_meta(id) ON DELETE CASCADE,
    FOREIGN KEY (qa_id) REFERENCES interview_qa_logs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS c3_user_baselines (
    id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, session_id INT NULL, warmup_id INT NULL,
    version INT NOT NULL, metrics JSON NOT NULL, confidence DOUBLE NOT NULL, source VARCHAR(50) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY c3_baseline_version (user_id, version),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES interview_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (warmup_id) REFERENCES c3_session_meta(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS c3_coaching_tips (
    id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, session_id INT NOT NULL, qa_id INT NULL,
    question_type VARCHAR(50) NULL, metric VARCHAR(100) NOT NULL, before_value DOUBLE NULL,
    baseline_version INT NULL, goal_text TEXT, tip TEXT NOT NULL, why TEXT, practice TEXT,
    approach_label VARCHAR(100) NULL, followed VARCHAR(20) NULL, after_value DOUBLE NULL,
    outcome_status VARCHAR(30) NOT NULL DEFAULT 'open', evaluated_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY c3_tip_finding (user_id, session_id, metric, question_type),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES interview_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (qa_id) REFERENCES interview_qa_logs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS c3_self_ratings (
    id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, session_id INT NOT NULL,
    improvement_rating INT NOT NULL, tip_clarity_rating INT NULL, tip_usefulness_rating INT NULL,
    comment TEXT, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY c3_rating (user_id, session_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES interview_sessions(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS c3_drift_events (
    id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, metric VARCHAR(100) NOT NULL,
    question_type VARCHAR(50) NOT NULL DEFAULT 'overall', z_score DOUBLE NOT NULL,
    direction VARCHAR(20) NOT NULL, classification VARCHAR(30) NOT NULL,
    detected_at_session_number INT NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY c3_drift_once (user_id, metric, question_type, detected_at_session_number),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

async function initC3(database = require("../../config/db").pool) {
  try {
    for (const statement of statements) await database.query(statement);
    return true;
  } catch (_error) {
    // Do not print driver errors: they can include SQL values or credentials.
    console.warn("C3 tables unavailable; the main interview service can still start.");
    return false;
  }
}
module.exports = { initC3, statements };
if (require.main === module) {
  const { pool } = require("../../config/db");
  initC3(pool).then((ok) => { process.exitCode = ok ? 0 : 1; }).finally(() => pool.end());
}
