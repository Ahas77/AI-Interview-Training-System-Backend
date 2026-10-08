const { pool } = require("../config/db");

const User = {
  async findByEmail(email) {
    const [rows] = await pool.query("SELECT * FROM users WHERE email = ? LIMIT 1", [email]);
    return rows[0] || null;
  },

  async findByMobile(mobile) {
    const [rows] = await pool.query("SELECT * FROM users WHERE mobile_contact_number = ? LIMIT 1", [mobile]);
    return rows[0] || null;
  },

  async findByNic(nic) {
    const [rows] = await pool.query("SELECT * FROM users WHERE nic = ? LIMIT 1", [nic]);
    return rows[0] || null;
  },

  async findById(id) {
    const [rows] = await pool.query(
      "SELECT id, first_name, last_name, email, mobile_contact_number, nic, address, date_of_birth, gender, role, avatar, created_at FROM users WHERE id = ? LIMIT 1",
      [id]
    );
    return rows[0] || null;
  },

  async createUser(userData) {
    const {
      first_name,
      last_name,
      email,
      mobile_contact_number,
      nic,
      address,
      date_of_birth,
      gender = "Male",
      password,
      role = "user",
      avatar = null,
    } = userData;

    const [result] = await pool.query(
      `INSERT INTO users (first_name, last_name, email, mobile_contact_number, nic, address, date_of_birth, gender, password, role, avatar)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        first_name,
        last_name,
        email,
        mobile_contact_number,
        nic,
        address || null,
        date_of_birth || null,
        gender || "Male",
        password,
        role,
        avatar,
      ]
    );

    return result.insertId;
  },
};

module.exports = User;
