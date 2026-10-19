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

// Get current user interview status and active session ID
router.get("/user-status", verifyToken, interviewController.getUserStatus);

// Complete session
router.post("/complete", verifyToken, interviewController.completeSession);

// Reset user interview status for new interview
router.post("/reset", verifyToken, interviewController.resetInterviewStatus);

// ── Technical Questionnaire Round (10 Questions) ──
router.post("/technical/start", verifyToken, interviewController.startTechnicalSession);
router.get("/technical/session/:id", verifyToken, interviewController.getTechnicalSession);
router.post("/technical/submit-answer", verifyToken, interviewController.submitTechnicalAnswer);
router.post("/technical/complete", verifyToken, interviewController.completeTechnicalSession);
router.get("/technical/summary/:sessionId", verifyToken, interviewController.getTechnicalSummary);

module.exports = router;
