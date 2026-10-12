const express = require("express");
const router = express.Router();
const c3Controller = require("../controllers/c3Controller");
const { verifyToken } = require("../middleware/authMiddleware");

router.post("/signals", verifyToken, c3Controller.ingestSignals);
router.post("/warmup", verifyToken, c3Controller.createWarmup);
router.post("/baseline/build", verifyToken, c3Controller.buildBaseline);
router.post("/baseline/refresh", verifyToken, c3Controller.refreshBaseline);

router.get("/progress/overview", verifyToken, c3Controller.overview);
router.get("/progress/per-type", verifyToken, c3Controller.perType);
router.get("/progress/comparison", verifyToken, c3Controller.comparison);
router.get("/session/:sessionId", verifyToken, c3Controller.sessionDetail);

router.get("/drift", verifyToken, c3Controller.drift);

router.post("/coaching/:sessionId/generate", verifyToken, c3Controller.generateCoaching);
router.get("/tips", verifyToken, c3Controller.getTips);
router.patch("/tips/:tipId/followed", verifyToken, c3Controller.patchTipFollowed);
router.post("/tips/evaluate", verifyToken, c3Controller.evaluateTips);
router.get("/tips/outcomes", verifyToken, c3Controller.tipOutcomes);

router.post("/self-rating", verifyToken, c3Controller.selfRating);

router.get("/evaluation/dataset", verifyToken, c3Controller.evaluationDataset);
router.get("/evaluation/csv", verifyToken, c3Controller.evaluationCsv);
router.get("/evaluation/correlation", verifyToken, c3Controller.correlationSummary);

module.exports = router;
