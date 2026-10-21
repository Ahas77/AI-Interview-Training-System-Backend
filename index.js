const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { initDB } = require("./src/config/db");
const authRoutes = require("./src/routes/authRoutes");
const cvRoutes = require("./src/routes/cvRoutes");
const interviewRoutes = require("./src/routes/interviewRoutes");
const behavioralAnalysisRoutes = require("./src/routes/behavioralAnalysisRoutes");

const app = express();
const port = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
const path = require("path");
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Routes
app.use("/api", authRoutes);
app.use("/api/cv", cvRoutes);
app.use("/api/interview", interviewRoutes);
app.use("/api/behavioral-analysis", behavioralAnalysisRoutes);
app.post("/api/log-devtools", (req, res) => res.status(200).json({ success: true }));
app.post("/api/devtools/log", (req, res) => res.status(200).json({ success: true }));

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Backend API Service is running.",
  });
});

async function startServer() {
  await initDB();
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

startServer();