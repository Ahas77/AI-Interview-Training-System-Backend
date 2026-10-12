require("dotenv").config();

const bcrypt = require("bcryptjs");
const { initDB, pool } = require("../src/config/db");

const seedUsers = [
  {
    first_name: "Demo",
    last_name: "Candidate",
    email: "candidate@example.com",
    mobile_contact_number: "0710000001",
    nic: "SEED-NIC-001",
    address: "Colombo, Sri Lanka",
    date_of_birth: "2000-01-01",
    gender: "Male",
    password: "Password@123",
    role: "user",
  },
  {
    first_name: "Test",
    last_name: "Applicant",
    email: "applicant@example.com",
    mobile_contact_number: "0710000002",
    nic: "SEED-NIC-002",
    address: "Kandy, Sri Lanka",
    date_of_birth: "1998-05-15",
    gender: "Female",
    password: "Password@123",
    role: "user",
  },
  {
    first_name: "Admin",
    last_name: "User",
    email: "admin@example.com",
    mobile_contact_number: "0710000003",
    nic: "SEED-NIC-003",
    address: "Colombo, Sri Lanka",
    date_of_birth: "1995-10-20",
    gender: "Male",
    password: "Admin@123",
    role: "admin",
  },
];

async function seed() {
  await initDB();

  for (const user of seedUsers) {
    const hashedPassword = await bcrypt.hash(user.password, 10);

    await pool.query(
      `
      INSERT INTO users (
        first_name,
        last_name,
        email,
        mobile_contact_number,
        nic,
        address,
        date_of_birth,
        gender,
        password,
        role
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        first_name = VALUES(first_name),
        last_name = VALUES(last_name),
        mobile_contact_number = VALUES(mobile_contact_number),
        nic = VALUES(nic),
        address = VALUES(address),
        date_of_birth = VALUES(date_of_birth),
        gender = VALUES(gender),
        password = VALUES(password),
        role = VALUES(role)
      `,
      [
        user.first_name,
        user.last_name,
        user.email,
        user.mobile_contact_number,
        user.nic,
        user.address,
        user.date_of_birth,
        user.gender,
        hashedPassword,
        user.role,
      ]
    );

    console.log(`Seeded ${user.role}: ${user.email} / ${user.password}`);
  }
}

seed()
  .then(async () => {
    await pool.end();
    console.log("User seeding complete.");
  })
  .catch(async (error) => {
    console.error("User seeding failed:", error.message);
    await pool.end();
    process.exit(1);
  });
