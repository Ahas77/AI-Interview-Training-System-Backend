const express = require("express");
const router = express.Router();
const cvController = require("../controllers/cvController");
const { verifyToken } = require("../middleware/authMiddleware");
const { cvUploadMiddleware } = require("../middleware/cvUploadMiddleware");

// Upload and analyze CV file
router.post("/upload", verifyToken, cvUploadMiddleware, cvController.uploadAndAnalyzeCV);

// Save chosen interview context (Company, Job Role, Expertise Level) when starting interview
router.post("/start-interview", verifyToken, cvController.saveInterviewContext);

// Fetch authenticated user's latest CV analysis
router.get("/latest", verifyToken, cvController.getLatestCV);

// Fetch specific CV analysis by ID
router.get("/:id", verifyToken, cvController.getCVById);

module.exports = router;
