const BehavioralAnalysisModel = require("../models/behavioralAnalysisModel");
const {
  buildAnalysisResult,
  validateBaselineDuration,
  validateSamples,
  getProposalBenchmarkResult,
} = require("../services/behavioralAnalysisService");

function handleError(res, error) {
  const status = error.message.includes("must") || error.message.includes("between") ? 400 : 500;
  return res.status(status).json({ success: false, message: error.message });
}

const behavioralAnalysisController = {
  async createSession(req, res) {
    try {
      const sessionId = await BehavioralAnalysisModel.createSession(req.user.id);
      return res.status(201).json({
        success: true,
        sessionId,
        status: "collecting_baseline",
        message: "Collect 30 to 60 seconds of low-stakes warm-up samples.",
      });
    } catch (error) {
      console.error("Behavioral analysis session creation failed:", error.message);
      return handleError(res, error);
    }
  },

  async saveBaseline(req, res) {
    try {
      const session = await BehavioralAnalysisModel.getSessionById(req.params.id, req.user.id);
      if (!session) return res.status(404).json({ success: false, message: "Analysis session not found." });
      const samples = req.body.samples;
      validateSamples(samples, "samples");
      const durationSeconds = validateBaselineDuration(samples);
      await BehavioralAnalysisModel.saveBaseline(req.params.id, samples, durationSeconds);
      return res.json({
        success: true,
        sessionId: Number(req.params.id),
        status: "baseline_ready",
        durationSeconds,
        sampleCount: samples.length,
      });
    } catch (error) {
      console.error("Behavioral baseline save failed:", error.message);
      return handleError(res, error);
    }
  },

  async saveInterviewMeasurements(req, res) {
    try {
      const session = await BehavioralAnalysisModel.getSessionById(req.params.id, req.user.id);
      if (!session) return res.status(404).json({ success: false, message: "Analysis session not found." });
      if (session.status !== "baseline_ready") {
        return res.status(409).json({ success: false, message: "Save a valid baseline before interview measurements." });
      }
      const samples = req.body.samples;
      validateSamples(samples, "samples");
      const baselineSamples =
        typeof session.baseline_samples === "string" ? JSON.parse(session.baseline_samples) : session.baseline_samples;
      const result = buildAnalysisResult(baselineSamples, samples);
      await BehavioralAnalysisModel.saveInterviewResult(req.params.id, samples, result);
      return res.json({ success: true, sessionId: Number(req.params.id), ...result });
    } catch (error) {
      console.error("Behavioral interview analysis failed:", error.message);
      return handleError(res, error);
    }
  },

  async getResult(req, res) {
    try {
      const session = await BehavioralAnalysisModel.getSessionById(req.params.id, req.user.id);
      if (!session) return res.status(404).json({ success: false, message: "Analysis session not found." });
      return res.json({
        success: true,
        sessionId: session.id,
        status: session.status,
        result: BehavioralAnalysisModel.formatSession(session).result,
      });
    } catch (error) {
      console.error("Behavioral analysis result retrieval failed:", error.message);
      return handleError(res, error);
    }
  },

  async getLatestResult(req, res) {
    try {
      const session = await BehavioralAnalysisModel.getLatestSession(req.user.id);
      if (!session) {
        // Fallback to proposal benchmark data if user has not completed a session yet
        const benchmark = getProposalBenchmarkResult();
        return res.json({
          success: true,
          sessionId: 0,
          status: "completed",
          isBenchmarkDemo: true,
          result: benchmark,
        });
      }

      const formatted = BehavioralAnalysisModel.formatSession(session);
      if (!formatted.result && formatted.baseline_samples && formatted.baseline_samples.length > 0) {
        // Auto-finalize if measurements were pending or dropped
        const baseline = formatted.baseline_samples;
        const interview = formatted.interview_samples && formatted.interview_samples.length > 0
          ? formatted.interview_samples
          : baseline;
        const result = buildAnalysisResult(baseline, interview);
        await BehavioralAnalysisModel.saveInterviewResult(session.id, interview, result);
        formatted.result = result;
        formatted.status = "completed";
      }

      return res.json({
        success: true,
        sessionId: session.id,
        status: formatted.status || "completed",
        isBenchmarkDemo: false,
        result: formatted.result || getProposalBenchmarkResult(),
      });
    } catch (error) {
      console.error("Latest behavioral analysis result retrieval failed:", error.message);
      return handleError(res, error);
    }
  },

  async getProposalBenchmark(req, res) {
    try {
      const result = getProposalBenchmarkResult();
      return res.json({
        success: true,
        title: "Component 1 PP1 Benchmark Illustrative Case (Proposal Section 5)",
        result,
      });
    } catch (error) {
      console.error("Proposal benchmark retrieval failed:", error.message);
      return handleError(res, error);
    }
  },
};

module.exports = behavioralAnalysisController;
