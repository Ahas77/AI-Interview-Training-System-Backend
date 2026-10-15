const C3Model = require("../models/c3Model");
const config = require("../config/c3Config");
const C3ProgressService = require("../services/c3ProgressService");
const frameRequests = new Set();

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function validateMetrics(metrics) {
  if (!isPlainObject(metrics)) return false;
  return Object.keys(metrics).length > 0 && Object.values(metrics).every((value) => typeof value === "number" && Number.isFinite(value));
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value) => {
    const str = value == null ? "" : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}

const c3Controller = {
  async analyzeAnswers(req, res) {
    try {
      const session = await C3Model.getSessionForUser(req.params.sessionId, req.user.id);
      if (!session) return res.status(404).json({ success: false, message: "Session not found or access denied." });
      if (session.status !== "completed") return res.status(422).json({ success: false, message: "Complete the interview before analysing saved answers." });
      if (!process.env.XAI_API_KEY) return res.status(503).json({ success: false, message: "Configure backend XAI_API_KEY first." });
      const { evaluateAnswer } = require("../services/c3AiService");
      const InterviewModel = require("../models/interviewModel");
      let analyzed = 0;
      for (const qa of await C3Model.getQALogsForSession(session.id)) {
        if (!qa.user_answer_text || qa.answer_score != null) continue;
        await InterviewModel.saveEvaluation(qa.id, session.id, await evaluateAnswer(qa.question_text, qa.user_answer_text));
        analyzed++;
      }
      return res.json({ success: true, data: { analyzed }, message: `${analyzed} answers analysed.` });
    } catch (_error) {
      return res.status(503).json({ success: false, message: "Grok answer analysis unavailable. Saved scores are retained; retry to analyse remaining answers." });
    }
  },
  async analyzeFrame(req, res) {
    const { sessionId, qaId, image, t_sec, consent } = req.body;
    if (consent !== true) return res.status(422).json({ success: false, message: "Camera analysis consent is required." });
    if (typeof t_sec !== "number" || !Number.isFinite(t_sec) || t_sec < 0 ||
      typeof image !== "string" || image.length > 350000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) {
      return res.status(422).json({ success: false, message: "A JPEG frame under 250 KB and valid timestamp are required." });
    }
    if (frameRequests.has(req.user.id)) return res.status(429).json({ success: false, message: "Wait before sending another camera frame." });
    frameRequests.add(req.user.id);
    const release = setTimeout(() => frameRequests.delete(req.user.id), 12000);
    release.unref();
    try {
      const session = await C3Model.getSessionForUser(sessionId, req.user.id);
      if (!session) return res.status(404).json({ success: false, message: "Session not found or access denied." });
      if (qaId) {
        const questions = await C3Model.getQALogsForSession(sessionId);
        if (!questions.some((q) => Number(q.id) === Number(qaId))) return res.status(404).json({ success: false, message: "Question not found for this session." });
      }
      const metrics = await require("../services/c3AiService").analyzeFrame(image);
      if (metrics) await C3Model.insertSignals(sessionId, qaId || null, [{ t_sec, source: "face", metrics }]);
      return res.json({ success: true, data: { status: metrics ? "recorded" : "no visible face", metrics } });
    } catch (_error) {
      return res.status(503).json({ success: false, message: "Grok camera analysis unavailable. Check backend XAI_API_KEY, model access and API quota." });
    }
  },
  async ingestSignals(req, res) {
    try {
      const userId = req.user.id;
      const { sessionId, qaId, readings } = req.body;

      if (!sessionId || !Array.isArray(readings)) {
        return res.status(400).json({ success: false, message: "sessionId and readings array are required." });
      }
      if (readings.length > config.MAX_SIGNAL_BATCH_SIZE) {
        return res.status(422).json({ success: false, message: `Signal batch cannot exceed ${config.MAX_SIGNAL_BATCH_SIZE} readings.` });
      }

      const session = await C3Model.getSessionForUser(sessionId, userId);
      if (!session) return res.status(404).json({ success: false, message: "Session not found or access denied." });
      if (qaId) {
        const qaLogs = await C3Model.getQALogsForSession(sessionId);
        const belongsToSession = qaLogs.some((qa) => Number(qa.id) === Number(qaId));
        if (!belongsToSession) {
          return res.status(404).json({ success: false, message: "Question log not found for this session." });
        }
      }

      const cleaned = [];
      for (const reading of readings) {
        if (typeof reading?.t_sec !== "number" || !Number.isFinite(reading.t_sec) || reading.t_sec < 0) {
          return res.status(422).json({ success: false, message: "Every reading requires numeric t_sec." });
        }
        if (!["face", "voice", "text"].includes(reading.source)) {
          return res.status(422).json({ success: false, message: "source must be face, voice, or text." });
        }
        if (!validateMetrics(reading.metrics)) {
          return res.status(422).json({ success: false, message: "All metrics must be numeric." });
        }
        cleaned.push({
          t_sec: Number(reading.t_sec),
          source: reading.source,
          metrics: reading.metrics,
        });
      }

      const inserted = await C3Model.insertSignals(sessionId, qaId || null, cleaned);
      return res.status(201).json({ success: true, message: "Signals stored successfully.", data: { inserted } });
    } catch (error) {
      console.error("C3 ingestSignals Error:", error);
      return res.status(500).json({ success: false, message: "Failed to store signals." });
    }
  },

  async createWarmup(req, res) {
    try {
      const userId = req.user.id;
      const { sessionId, company, jobRole, expertiseLevel } = req.body;

      if (sessionId) {
        const updated = await C3Model.markWarmupSession(sessionId, userId);
        if (!updated) return res.status(404).json({ success: false, message: "Session not found or access denied." });
        return res.status(200).json({ success: true, message: "Session marked as warm-up.", data: { sessionId } });
      }

      const newSessionId = await C3Model.createWarmupSession({
        userId,
        targetCompany: company || null,
        jobRole: jobRole || "Warm-up Baseline",
        expertiseLevel: expertiseLevel || "Baseline",
      });
      return res.status(201).json({ success: true, message: "Warm-up session created.", data: { sessionId: newSessionId } });
    } catch (error) {
      console.error("C3 createWarmup Error:", error);
      return res.status(500).json({ success: false, message: "Failed to create warm-up session." });
    }
  },

  async buildBaseline(req, res) {
    try {
      const userId = req.user.id;
      const { sessionId } = req.body;
      if (sessionId) {
        const session = await C3Model.getSessionForUser(sessionId, userId);
        if (!session) return res.status(404).json({ success: false, message: "Session not found or access denied." });
      }
      const result = await C3ProgressService.buildBaselineForSession(userId, sessionId || null);
      const statusCode = result.status === "ready" ? 201 : 422;
      return res.status(statusCode).json({ success: result.status === "ready", message: result.message || "Baseline built successfully.", data: result });
    } catch (error) {
      console.error("C3 buildBaseline Error:", error);
      return res.status(500).json({ success: false, message: "Failed to build baseline." });
    }
  },

  async overview(req, res) {
    try {
      const data = await C3ProgressService.progressOverview(req.user.id);
      return res.status(200).json({ success: true, message: "Progress overview fetched.", data });
    } catch (error) {
      console.error("C3 overview Error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch progress overview." });
    }
  },

  async perType(req, res) {
    try {
      const data = await C3ProgressService.perTypeAnalysis(req.user.id);
      return res.status(200).json({ success: true, message: "Per-type analysis fetched.", data });
    } catch (error) {
      console.error("C3 perType Error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch per-type analysis." });
    }
  },

  async sessionDetail(req, res) {
    try {
      const sessionId = parseInt(req.params.sessionId, 10);
      if (isNaN(sessionId)) return res.status(400).json({ success: false, message: "Invalid session ID." });
      await C3ProgressService.evaluateOpenTips(req.user.id);
      const summary = await C3ProgressService.getSessionSummary(sessionId, req.user.id);
      if (!summary) return res.status(404).json({ success: false, message: "Session not found or access denied." });
      const tips = await C3Model.getTipsForUser(req.user.id, sessionId);
      return res.status(200).json({ success: true, message: "Session detail fetched.", data: { ...summary, coaching_tips: tips } });
    } catch (error) {
      console.error("C3 sessionDetail Error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch session detail." });
    }
  },

  async comparison(req, res) {
    try {
      const data = await C3ProgressService.progressComparison(req.user.id);
      return res.status(200).json({ success: true, message: "Progress comparison fetched.", data });
    } catch (error) {
      console.error("C3 comparison Error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch progress comparison." });
    }
  },

  async drift(req, res) {
    try {
      const data = await C3ProgressService.detectDrift(req.user.id);
      return res.status(200).json({ success: true, message: "Drift detection completed.", data });
    } catch (error) {
      console.error("C3 drift Error:", error);
      return res.status(500).json({ success: false, message: "Failed to detect drift." });
    }
  },

  async refreshBaseline(req, res) {
    try {
      if (req.body.sessionId && !await C3Model.getSessionForUser(req.body.sessionId, req.user.id)) {
        return res.status(404).json({ success: false, message: "Session not found or access denied." });
      }
      const result = await C3ProgressService.buildBaselineForSession(req.user.id, req.body.sessionId || null);
      return res.status(result.status === "ready" ? 201 : 422).json({
        success: result.status === "ready",
        message: result.message || "Baseline refreshed.",
        data: result,
      });
    } catch (error) {
      console.error("C3 refreshBaseline Error:", error);
      return res.status(500).json({ success: false, message: "Failed to refresh baseline." });
    }
  },

  async generateCoaching(req, res) {
    try {
      const sessionId = parseInt(req.params.sessionId, 10);
      if (isNaN(sessionId)) return res.status(400).json({ success: false, message: "Invalid session ID." });
      const data = await C3ProgressService.generateCoaching(req.user.id, sessionId);
      if (!data) return res.status(404).json({ success: false, message: "Session not found or access denied." });
      return res.status(201).json({ success: data.status === "ready", message: data.message || "Coaching tips generated.", data });
    } catch (error) {
      console.error("C3 generateCoaching Error:", error);
      return res.status(500).json({ success: false, message: "Failed to generate coaching tips." });
    }
  },

  async getTips(req, res) {
    try {
      const sessionId = req.query.sessionId ? parseInt(req.query.sessionId, 10) : null;
      const tips = await C3Model.getTipsForUser(req.user.id, sessionId);
      return res.status(200).json({ success: true, message: "Tips fetched.", data: tips });
    } catch (error) {
      console.error("C3 getTips Error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch tips." });
    }
  },

  async patchTipFollowed(req, res) {
    try {
      const tipId = parseInt(req.params.tipId, 10);
      const { followed } = req.body;
      if (!["yes", "partly", "no"].includes(followed)) {
        return res.status(422).json({ success: false, message: "followed must be yes, partly, or no." });
      }
      const updated = await C3Model.patchTipFollowed(tipId, req.user.id, followed);
      if (!updated) return res.status(404).json({ success: false, message: "Tip not found or access denied." });
      return res.status(200).json({ success: true, message: "Tip follow status updated.", data: { tipId, followed } });
    } catch (error) {
      console.error("C3 patchTipFollowed Error:", error);
      return res.status(500).json({ success: false, message: "Failed to update tip." });
    }
  },

  async evaluateTips(req, res) {
    try {
      const results = await C3ProgressService.evaluateOpenTips(req.user.id);
      return res.status(200).json({ success: true, message: "Tip outcomes evaluated.", data: results });
    } catch (error) {
      console.error("C3 evaluateTips Error:", error);
      return res.status(500).json({ success: false, message: "Failed to evaluate tips." });
    }
  },

  async tipOutcomes(req, res) {
    try {
      const tips = await C3Model.getTipsForUser(req.user.id);
      const data = tips.map((tip) => ({
        ...tip,
        last_time_vs_now:
          tip.after_value == null
            ? "Not enough later-session data to evaluate yet."
            : `${tip.metric} moved from ${tip.before_value} to ${tip.after_value}; outcome is ${tip.outcome_status}.`,
      }));
      return res.status(200).json({ success: true, message: "Tip outcomes fetched.", data });
    } catch (error) {
      console.error("C3 tipOutcomes Error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch tip outcomes." });
    }
  },

  async selfRating(req, res) {
    try {
      const userId = req.user.id;
      const { sessionId, improvementRating, tipClarityRating, tipUsefulnessRating, comment } = req.body;
      const session = await C3Model.getSessionForUser(sessionId, userId);
      if (!session) return res.status(404).json({ success: false, message: "Session not found or access denied." });
      if (!Number.isInteger(Number(improvementRating)) || Number(improvementRating) < 1 || Number(improvementRating) > 5) {
        return res.status(422).json({ success: false, message: "improvementRating must be between 1 and 5." });
      }
      await C3Model.upsertSelfRating({
        userId,
        sessionId,
        improvementRating: Number(improvementRating),
        tipClarityRating: tipClarityRating ? Number(tipClarityRating) : null,
        tipUsefulnessRating: tipUsefulnessRating ? Number(tipUsefulnessRating) : null,
        comment,
      });
      return res.status(200).json({ success: true, message: "Self-rating saved.", data: { sessionId } });
    } catch (error) {
      console.error("C3 selfRating Error:", error);
      return res.status(500).json({ success: false, message: "Failed to save self-rating." });
    }
  },

  async evaluationDataset(req, res) {
    try {
      if (req.user.role !== "admin") return res.status(403).json({ success: false, message: "Admin access required." });
      const includeDemo = req.query.includeDemo === "true";
      const rows = await C3ProgressService.evaluationRows(includeDemo);
      return res.status(200).json({ success: true, message: "Evaluation dataset fetched.", data: rows });
    } catch (error) {
      console.error("C3 evaluationDataset Error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch evaluation dataset." });
    }
  },

  async evaluationCsv(req, res) {
    try {
      if (req.user.role !== "admin") return res.status(403).json({ success: false, message: "Admin access required." });
      const rows = await C3ProgressService.evaluationRows(req.query.includeDemo === "true");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=c3-evaluation.csv");
      return res.status(200).send(toCsv(rows));
    } catch (error) {
      console.error("C3 evaluationCsv Error:", error);
      return res.status(500).json({ success: false, message: "Failed to export evaluation CSV." });
    }
  },

  async correlationSummary(req, res) {
    try {
      if (req.user.role !== "admin") return res.status(403).json({ success: false, message: "Admin access required." });
      const data = await C3ProgressService.correlationSummary(req.query.includeDemo === "true");
      return res.status(200).json({ success: true, message: "Correlation summary fetched.", data });
    } catch (error) {
      console.error("C3 correlationSummary Error:", error);
      return res.status(500).json({ success: false, message: "Failed to calculate correlation summary." });
    }
  },
};

module.exports = c3Controller;
