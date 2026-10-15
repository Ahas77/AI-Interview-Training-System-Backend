const mysql = require("mysql2/promise");
require("dotenv").config();

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  port: parseInt(process.env.DB_PORT || "3306", 10),
};

const pool = mysql.createPool({
  ...dbConfig,
  database: process.env.DB_NAME || "interview_db",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function addColumnIfMissing(tableName, columnName, alterSql) {
  try {
    const dbName = process.env.DB_NAME || "interview_db";
    const [rows] = await pool.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
       LIMIT 1`,
      [dbName, tableName, columnName]
    );

    if (!rows || rows.length === 0) {
      await pool.query(alterSql);
    }
  } catch (error) {
    console.warn(`Migration warning for ${tableName}.${columnName}:`, error.message);
  }
}

async function initDB() {
  try {
    // 1. Connect without database to ensure database exists
    const tempConnection = await mysql.createConnection(dbConfig);
    const dbName = process.env.DB_NAME || "interview_db";
    await tempConnection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
    await tempConnection.end();

    // 2. Create users table if not exists
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(150) NOT NULL UNIQUE,
        mobile_contact_number VARCHAR(20) NOT NULL UNIQUE,
        nic VARCHAR(50) NOT NULL UNIQUE,
        address TEXT,
        date_of_birth DATE,
        gender VARCHAR(20) DEFAULT 'Male',
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'user',
        avatar VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;

    await pool.query(createTableQuery);

    // Migration for existing table
    try {
      await pool.query("ALTER TABLE users ADD COLUMN gender VARCHAR(20) DEFAULT 'Male';");
    } catch (e) {
      // Column already exists
    }

    // 3. Create cv_analysis table if not exists
    const createCVAnalysisTableQuery = `
      CREATE TABLE IF NOT EXISTS cv_analysis (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        raw_text LONGTEXT NOT NULL,
        parsed_data JSON NOT NULL,
        candidate_name VARCHAR(255) DEFAULT NULL,
        email VARCHAR(255) DEFAULT NULL,
        phone VARCHAR(100) DEFAULT NULL,
        experience_years INT DEFAULT NULL,
        skills JSON DEFAULT NULL,
        suggested_role VARCHAR(255) DEFAULT NULL,
        suggested_level VARCHAR(100) DEFAULT NULL,
        target_company VARCHAR(255) DEFAULT NULL,
        target_job_role VARCHAR(255) DEFAULT NULL,
        target_expertise_level VARCHAR(100) DEFAULT NULL,
        status VARCHAR(50) DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_cv_user_id (user_id),
        INDEX idx_cv_created_at (created_at),
        CONSTRAINT fk_cv_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;

    await pool.query(createCVAnalysisTableQuery);

    // Migrations for existing cv_analysis table
    const columnsToAdd = [
      "ALTER TABLE cv_analysis ADD COLUMN target_company VARCHAR(255) DEFAULT NULL;",
      "ALTER TABLE cv_analysis ADD COLUMN target_job_role VARCHAR(255) DEFAULT NULL;",
      "ALTER TABLE cv_analysis ADD COLUMN target_expertise_level VARCHAR(100) DEFAULT NULL;",
      "ALTER TABLE cv_analysis ADD COLUMN status VARCHAR(50) DEFAULT 'draft';",
    ];

    for (const colQuery of columnsToAdd) {
      try {
        await pool.query(colQuery);
      } catch (e) {
        // Column already exists
      }
    }

    // 4. Create interview_sessions table if not exists
    const createSessionsTableQuery = `
      CREATE TABLE IF NOT EXISTS interview_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        cv_id INT DEFAULT NULL,
        target_company VARCHAR(100) DEFAULT NULL,
        job_role VARCHAR(100) NOT NULL,
        expertise_level VARCHAR(50) NOT NULL,
        session_type VARCHAR(50) DEFAULT 'interview',
        session_number INT DEFAULT NULL,
        status VARCHAR(50) DEFAULT 'in_progress',
        total_questions INT DEFAULT 5,
        current_question_index INT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        INDEX idx_session_user (user_id),
        CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_session_cv FOREIGN KEY (cv_id) REFERENCES cv_analysis(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await pool.query(createSessionsTableQuery);

    await addColumnIfMissing(
      "interview_sessions",
      "session_type",
      "ALTER TABLE interview_sessions ADD COLUMN session_type VARCHAR(50) DEFAULT 'interview';"
    );
    await addColumnIfMissing(
      "interview_sessions",
      "session_number",
      "ALTER TABLE interview_sessions ADD COLUMN session_number INT DEFAULT NULL;"
    );

    // 5. Create interview_qa_logs table if not exists
    const createQALogsTableQuery = `
      CREATE TABLE IF NOT EXISTS interview_qa_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id INT NOT NULL,
        question_number INT NOT NULL,
        question_type VARCHAR(50) DEFAULT 'hr',
        question_text TEXT NOT NULL,
        user_answer_text TEXT DEFAULT NULL,
        answered_at TIMESTAMP NULL,
        answer_word_count INT DEFAULT NULL,
        answer_score DECIMAL(10,2) DEFAULT NULL,
        response_latency_sec DECIMAL(10,2) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_qa_session (session_id),
        CONSTRAINT fk_qa_session FOREIGN KEY (session_id) REFERENCES interview_sessions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await pool.query(createQALogsTableQuery);

    await addColumnIfMissing(
      "interview_qa_logs",
      "question_type",
      "ALTER TABLE interview_qa_logs ADD COLUMN question_type VARCHAR(50) DEFAULT 'hr';"
    );
    await addColumnIfMissing(
      "interview_qa_logs",
      "answered_at",
      "ALTER TABLE interview_qa_logs ADD COLUMN answered_at TIMESTAMP NULL;"
    );
    await addColumnIfMissing(
      "interview_qa_logs",
      "answer_word_count",
      "ALTER TABLE interview_qa_logs ADD COLUMN answer_word_count INT DEFAULT NULL;"
    );
    await addColumnIfMissing(
      "interview_qa_logs",
      "answer_score",
      "ALTER TABLE interview_qa_logs ADD COLUMN answer_score DECIMAL(10,2) DEFAULT NULL;"
    );
    await addColumnIfMissing(
      "interview_qa_logs",
      "response_latency_sec",
      "ALTER TABLE interview_qa_logs ADD COLUMN response_latency_sec DECIMAL(10,2) DEFAULT NULL;"
    );

    await addColumnIfMissing("interview_qa_logs", "answer_feedback",
      "ALTER TABLE interview_qa_logs ADD COLUMN answer_feedback TEXT DEFAULT NULL;");

    // 6. C3 signal readings from face, voice, or text components
    await pool.query(`
      CREATE TABLE IF NOT EXISTS session_signals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id INT NOT NULL,
        qa_id INT DEFAULT NULL,
        t_sec DECIMAL(10,2) NOT NULL,
        source VARCHAR(50) NOT NULL,
        metrics JSON NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_signal_session (session_id),
        INDEX idx_signal_qa (qa_id),
        CONSTRAINT fk_signal_session FOREIGN KEY (session_id) REFERENCES interview_sessions(id) ON DELETE CASCADE,
        CONSTRAINT fk_signal_qa FOREIGN KEY (qa_id) REFERENCES interview_qa_logs(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 7. C3 user baseline versions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_baselines (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        session_id INT DEFAULT NULL,
        version INT NOT NULL,
        metrics JSON NOT NULL,
        confidence DECIMAL(5,4) DEFAULT 0,
        source VARCHAR(50) DEFAULT 'warmup',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_baseline_user_version (user_id, version),
        CONSTRAINT fk_baseline_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_baseline_session FOREIGN KEY (session_id) REFERENCES interview_sessions(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await addColumnIfMissing(
      "user_baselines",
      "source",
      "ALTER TABLE user_baselines ADD COLUMN source VARCHAR(50) DEFAULT 'warmup';"
    );

    // 8. C3 explainable coaching tips and outcomes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS coaching_tips (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        session_id INT NOT NULL,
        qa_id INT DEFAULT NULL,
        question_type VARCHAR(50) DEFAULT NULL,
        metric VARCHAR(100) NOT NULL,
        before_value DECIMAL(10,4) DEFAULT NULL,
        goal_text TEXT,
        tip TEXT NOT NULL,
        why TEXT,
        practice TEXT,
        approach_label VARCHAR(100) DEFAULT NULL,
        followed VARCHAR(20) DEFAULT NULL,
        after_value DECIMAL(10,4) DEFAULT NULL,
        outcome_status VARCHAR(50) DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        evaluated_at TIMESTAMP NULL,
        INDEX idx_tip_user_session (user_id, session_id),
        INDEX idx_tip_qa (qa_id),
        CONSTRAINT fk_tip_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_tip_session FOREIGN KEY (session_id) REFERENCES interview_sessions(id) ON DELETE CASCADE,
        CONSTRAINT fk_tip_qa FOREIGN KEY (qa_id) REFERENCES interview_qa_logs(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await addColumnIfMissing(
      "coaching_tips",
      "approach_label",
      "ALTER TABLE coaching_tips ADD COLUMN approach_label VARCHAR(100) DEFAULT NULL;"
    );

    await addColumnIfMissing("coaching_tips", "baseline_version",
      "ALTER TABLE coaching_tips ADD COLUMN baseline_version INT DEFAULT NULL;");

    // 9. C3 post-session self-ratings
    await pool.query(`
      CREATE TABLE IF NOT EXISTS self_ratings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        session_id INT NOT NULL,
        improvement_rating INT NOT NULL,
        tip_clarity_rating INT DEFAULT NULL,
        tip_usefulness_rating INT DEFAULT NULL,
        comment TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_self_rating_user_session (user_id, session_id),
        INDEX idx_self_rating_user (user_id),
        CONSTRAINT fk_self_rating_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_self_rating_session FOREIGN KEY (session_id) REFERENCES interview_sessions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 10. C3 baseline drift events
    await pool.query(`
      CREATE TABLE IF NOT EXISTS drift_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        metric VARCHAR(100) NOT NULL,
        question_type VARCHAR(50) DEFAULT NULL,
        z_score DECIMAL(10,4) NOT NULL,
        direction VARCHAR(20) NOT NULL,
        classification VARCHAR(50) NOT NULL,
        detected_at_session_number INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_drift_event (user_id, metric, question_type, detected_at_session_number),
        INDEX idx_drift_user (user_id),
        CONSTRAINT fk_drift_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log("Database, users, cv_analysis, interview_sessions & interview_qa_logs tables initialized successfully.");
  } catch (error) {
    console.error("Database initialization error:", error.message);
  }
}

module.exports = {
  pool,
  initDB,
};
