const express = require("express");
const router = express.Router();
const interviewController = require("../controllers/interviewController");
const { verifyToken } = require("../middleware/authMiddleware");

// Start new interview session
router.post("/start", verifyToken, interviewController.startSession);

// Get session details and active question
router.get("/session/:id", verifyToken, interviewController.getSession);

// Submit answer for active question & get next question
router.post("/submit-answer", verifyToken, interviewController.submitAnswer);

// Complete session
router.post("/complete", verifyToken, interviewController.completeSession);

module.exports = router;
