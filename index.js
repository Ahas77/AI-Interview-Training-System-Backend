const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { initDB } = require("./src/config/db");
const authRoutes = require("./src/routes/authRoutes");
const cvRoutes = require("./src/routes/cvRoutes");
const interviewRoutes = require("./src/routes/interviewRoutes");
const companyRequirementsRoutes = require("./src/routes/companyRequirementsRoutes");
const behavioralAnalysisRoutes = require("./src/routes/behavioralAnalysisRoutes");


const app = express();
const port = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(require("./src/c3/middleware/observer"));

// Routes
app.use("/api", authRoutes);
app.use("/api/cv", cvRoutes);
app.use("/api/interview", interviewRoutes);
app.use("/api/c3", require("./src/c3/routes"));
app.use("/api/company-requirements", companyRequirementsRoutes);
app.use("/api/behavioral-analysis", behavioralAnalysisRoutes);


app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Backend API Service is running.",
  });
});

async function startServer() {
  await initDB();
  await require("./src/c3/db/initC3").initC3();
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

startServer();