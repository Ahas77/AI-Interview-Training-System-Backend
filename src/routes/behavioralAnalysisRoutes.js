const express = require("express");
const router = express.Router();
const controller = require("../controllers/behavioralAnalysisController");
const { verifyToken } = require("../middleware/authMiddleware");

router.post("/sessions", verifyToken, controller.createSession);
router.post("/sessions/:id/baseline", verifyToken, controller.saveBaseline);
router.post("/sessions/:id/measurements", verifyToken, controller.saveInterviewMeasurements);
router.get("/sessions/:id/result", verifyToken, controller.getResult);
router.get("/latest", verifyToken, controller.getLatestResult);
router.get("/benchmark", controller.getProposalBenchmark);

module.exports = router;
