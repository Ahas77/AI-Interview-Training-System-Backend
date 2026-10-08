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

    // 5. Create interview_qa_logs table if not exists
    const createQALogsTableQuery = `
      CREATE TABLE IF NOT EXISTS interview_qa_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id INT NOT NULL,
        question_number INT NOT NULL,
        question_text TEXT NOT NULL,
        user_answer_text TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_qa_session (session_id),
        CONSTRAINT fk_qa_session FOREIGN KEY (session_id) REFERENCES interview_sessions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await pool.query(createQALogsTableQuery);

    console.log("Database, users, cv_analysis, interview_sessions & interview_qa_logs tables initialized successfully.");
  } catch (error) {
    console.error("Database initialization error:", error.message);
  }
}

module.exports = {
  pool,
  initDB,
};
