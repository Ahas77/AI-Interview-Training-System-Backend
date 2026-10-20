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
        interview_status VARCHAR(50) DEFAULT 'no_cv',
        active_session_id INT DEFAULT NULL,
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
    try {
      await pool.query("ALTER TABLE users ADD COLUMN interview_status VARCHAR(50) DEFAULT 'no_cv';");
    } catch (e) {
      // Column already exists
    }
    try {
      await pool.query("ALTER TABLE users ADD COLUMN active_session_id INT DEFAULT NULL;");
    } catch (e) {
      // Column already exists
    }

    // Synchronize any existing in-progress sessions to users table
    try {
      await pool.query(`
        UPDATE users u
        JOIN interview_sessions s ON u.id = s.user_id AND (s.status = 'in_progress' OR s.status = 'hr_pending')
        SET u.interview_status = 'hr_pending', u.active_session_id = s.id
        WHERE u.interview_status IS NULL OR u.interview_status = 'no_cv';
      `);
    } catch (syncErr) {
      // Ignore if table doesn't exist yet
    }

    // Synchronize any existing uploaded CVs where status is still no_cv
    try {
      await pool.query(`
        UPDATE users u
        JOIN cv_analysis c ON u.id = c.user_id
        SET u.interview_status = 'cv_uploaded'
        WHERE (u.interview_status IS NULL OR u.interview_status = 'no_cv') AND u.active_session_id IS NULL;
      `);
    } catch (syncCvErr) {
      // Ignore if table doesn't exist yet
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

    // 6. Create companies table if not exists
    const createCompaniesTableQuery = `
      CREATE TABLE IF NOT EXISTS companies (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        normalized_name VARCHAR(255) NOT NULL UNIQUE,
        official_careers_url VARCHAR(500) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_comp_norm (normalized_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await pool.query(createCompaniesTableQuery);

    // 7. Create company_job_postings table if not exists
    const createPostingsTableQuery = `
      CREATE TABLE IF NOT EXISTS company_job_postings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_id INT NOT NULL,
        external_job_id VARCHAR(255) DEFAULT NULL,
        job_title VARCHAR(255) NOT NULL,
        location VARCHAR(255) DEFAULT 'Any / Remote',
        seniority_level VARCHAR(100) DEFAULT 'Intermediate',
        source_url VARCHAR(1000) NOT NULL,
        source_type VARCHAR(100) DEFAULT 'careers_page',
        raw_job_description LONGTEXT,
        published_at TIMESTAMP NULL,
        last_verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) DEFAULT 'verified',
        content_hash VARCHAR(64) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_post_comp (company_id),
        INDEX idx_post_hash (content_hash),
        INDEX idx_post_verified (last_verified_at),
        CONSTRAINT fk_post_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await pool.query(createPostingsTableQuery);

    // 8. Create company_job_requirements table if not exists
    const createRequirementsTableQuery = `
      CREATE TABLE IF NOT EXISTS company_job_requirements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        job_posting_id INT NOT NULL,
        requirement_category VARCHAR(100) NOT NULL,
        requirement_name VARCHAR(255) NOT NULL,
        requirement_type VARCHAR(50) DEFAULT 'required',
        requirement_description TEXT,
        evidence_excerpt TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_req_post (job_posting_id),
        INDEX idx_req_category (requirement_category),
        CONSTRAINT fk_req_post FOREIGN KEY (job_posting_id) REFERENCES company_job_postings(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await pool.query(createRequirementsTableQuery);

    // 9. Create company_search_logs table if not exists
    const createSearchLogsTableQuery = `
      CREATE TABLE IF NOT EXISTS company_search_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_name VARCHAR(255) NOT NULL,
        job_role VARCHAR(255) NOT NULL,
        seniority_level VARCHAR(100) DEFAULT NULL,
        location VARCHAR(255) DEFAULT NULL,
        search_status VARCHAR(50) NOT NULL,
        results_count INT DEFAULT 0,
        error_message TEXT DEFAULT NULL,
        searched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_log_search (company_name, job_role)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await pool.query(createSearchLogsTableQuery);

    // 10. Migrations for interview_sessions (technical round & company link)
    const sessionCols = [
      "ALTER TABLE interview_sessions ADD COLUMN round_type VARCHAR(50) DEFAULT 'hr';",
      "ALTER TABLE interview_sessions ADD COLUMN job_posting_id INT DEFAULT NULL;",
      "ALTER TABLE interview_sessions ADD COLUMN technical_score INT DEFAULT NULL;",
      "ALTER TABLE interview_sessions ADD COLUMN parent_session_id INT DEFAULT NULL;",
    ];
    for (const sCol of sessionCols) {
      try {
        await pool.query(sCol);
      } catch (e) {
        // Column already exists
      }
    }

    // 11. Migrations for interview_qa_logs (evaluation status, score, feedback, correct_answer)
    const qaCols = [
      "ALTER TABLE interview_qa_logs ADD COLUMN evaluation_status VARCHAR(50) DEFAULT NULL;",
      "ALTER TABLE interview_qa_logs ADD COLUMN score INT DEFAULT NULL;",
      "ALTER TABLE interview_qa_logs ADD COLUMN feedback TEXT DEFAULT NULL;",
      "ALTER TABLE interview_qa_logs ADD COLUMN correct_answer TEXT DEFAULT NULL;",
      "ALTER TABLE interview_qa_logs ADD COLUMN category VARCHAR(100) DEFAULT NULL;",
      "ALTER TABLE interview_qa_logs ADD COLUMN evaluated_at TIMESTAMP NULL DEFAULT NULL;",
    ];
    for (const qCol of qaCols) {
      try {
        await pool.query(qCol);
      } catch (e) {
        // Column already exists
      }
    }

    // 6. Component 1: personalized vocal and facial behavioral analysis
    const createBehavioralAnalysisTableQuery = `
      CREATE TABLE IF NOT EXISTS behavioral_analysis_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        status VARCHAR(50) DEFAULT 'collecting_baseline',
        baseline_samples JSON NOT NULL,
        baseline_duration_seconds DECIMAL(6,2) DEFAULT NULL,
        interview_samples JSON DEFAULT NULL,
        result JSON DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_behavioral_user (user_id),
        CONSTRAINT fk_behavioral_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await pool.query(createBehavioralAnalysisTableQuery);

    console.log("Database, interview, company intelligence, technical and behavioral tables initialized successfully.");

  } catch (error) {
    console.error("Database initialization error:", error.message);
  }
}

module.exports = {
  pool,
  initDB,
};
