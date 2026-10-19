const AIProvider = require("./ai/aiProvider");
const InterviewModel = require("../models/interviewModel");

/**
 * Technical Evaluation Service
 * Evaluates candidate technical interview answers in batch using AI,
 * assigns correct/partially_correct/wrong status, scores, feedback,
 * and generates ideal correct answers for learning and review.
 */
class TechnicalEvaluationService {
  /**
   * Evaluate all asked questions and user answers for a technical session.
   * Caches results in the database so repeated loads are instant.
   */
  static async evaluateTechnicalSession(sessionId, userId) {
    const session = await InterviewModel.getSessionById(sessionId, userId);
    if (!session) {
      throw new Error("Interview session not found.");
    }

    const qaLogs = await InterviewModel.getQALogs(sessionId);
    if (!qaLogs || qaLogs.length === 0) {
      return {
        session,
        overallScore: 0,
        summary: "No questions recorded for this session.",
        totalQuestions: 0,
        correctCount: 0,
        partiallyCorrectCount: 0,
        wrongCount: 0,
        evaluations: [],
      };
    }

    // Check if all logs are already evaluated
    const unevaluated = qaLogs.filter(
      (log) => !log.evaluation_status || !log.evaluated_at
    );

    if (unevaluated.length === 0) {
      // Already evaluated! Return cached results
      return this.formatSummaryResponse(session, qaLogs);
    }

    // Prepare Q&A bundle for AI evaluation
    const questionsToEvaluate = qaLogs.map((log) => ({
      qaId: log.id,
      questionNumber: log.question_number,
      questionText: log.question_text,
      userAnswer: log.user_answer_text || "",
    }));

    const systemPrompt = `You are a Principal Software Engineering Evaluator assessing a candidate's completed technical interview round.
Target Role: ${session.job_role}
Target Company: ${session.target_company || "Enterprise Tech Company"}
Seniority Level: ${session.expertise_level}

EVALUATION CRITERIA:
1. "status": Exactly one of ["correct", "partially_correct", "wrong"].
   - "correct": The answer is technically accurate, explains key principles/trade-offs, or provides functional code/approach.
   - "partially_correct": The answer grasps some core concepts, but missed key architecture/edge cases, contains inaccuracies, or lacks depth.
   - "wrong": The answer is incorrect, severely misleading, empty, or fails to address the question.
2. "score": An integer from 0 to 100 based on accuracy and technical depth.
3. "feedback": 2-3 sentences explaining what was strong, what was inaccurate/missing, and constructive advice.
4. "correct_answer": A comprehensive, high-quality technical model answer explaining the correct solution clearly, including key concepts, architectural patterns, and code snippet where appropriate.

OUTPUT STRICTLY IN JSON FORMAT:
{
  "overall_score": 80,
  "overall_summary": "2-sentence overall summary of candidate technical strengths and weak areas.",
  "evaluations": [
    {
      "question_number": 1,
      "status": "correct | partially_correct | wrong",
      "score": 85,
      "feedback": "Explanation of answer accuracy...",
      "correct_answer": "Complete correct technical solution and explanation..."
    }
  ]
}`;

    const userPrompt = `Evaluate the candidate's answers for these ${questionsToEvaluate.length} technical questions:\n${JSON.stringify(
      questionsToEvaluate,
      null,
      2
    )}`;

    try {
      const evaluationResult = await AIProvider.generateJSON(systemPrompt, userPrompt);

      const evalList = Array.isArray(evaluationResult?.evaluations)
        ? evaluationResult.evaluations
        : [];
      const overallScore =
        typeof evaluationResult?.overall_score === "number"
          ? evaluationResult.overall_score
          : null;

      // Update DB for each Q&A log
      for (const log of qaLogs) {
        const item =
          evalList.find((e) => e.question_number === log.question_number) || {};
        const status =
          item.status &&
          ["correct", "partially_correct", "wrong"].includes(item.status)
            ? item.status
            : log.user_answer_text && log.user_answer_text.trim().length > 15
            ? "partially_correct"
            : "wrong";

        const score =
          typeof item.score === "number"
            ? item.score
            : status === "correct"
            ? 90
            : status === "partially_correct"
            ? 55
            : 20;

        const feedback =
          item.feedback ||
          (status === "correct"
            ? "Accurate technical response addressing key requirements."
            : "Answer lacks critical technical depth or implementation specifics.");

        const correctAnswer =
          item.correct_answer ||
          "The ideal technical solution should cover core architecture, runtime efficiency, and best engineering practices.";

        await InterviewModel.updateQAEvaluation(log.id, {
          evaluationStatus: status,
          score,
          feedback,
          correctAnswer,
        });

        // Mutate in-memory log
        log.evaluation_status = status;
        log.score = score;
        log.feedback = feedback;
        log.correct_answer = correctAnswer;
        log.evaluated_at = new Date();
      }

      // Calculate or save overall session score
      const calculatedScore =
        overallScore !== null
          ? overallScore
          : Math.round(
              qaLogs.reduce((acc, curr) => acc + (curr.score || 0), 0) /
                qaLogs.length
            );

      await InterviewModel.updateSessionScore(sessionId, calculatedScore);
      session.technical_score = calculatedScore;

      return this.formatSummaryResponse(
        session,
        qaLogs,
        evaluationResult?.overall_summary
      );
    } catch (err) {
      console.error("TechnicalEvaluationService evaluation error:", err);
      return this.fallbackEvaluation(session, qaLogs);
    }
  }

  static formatSummaryResponse(session, qaLogs, summaryText = null) {
    const totalQuestions = qaLogs.length;
    const correctCount = qaLogs.filter(
      (l) => l.evaluation_status === "correct"
    ).length;
    const partiallyCorrectCount = qaLogs.filter(
      (l) => l.evaluation_status === "partially_correct"
    ).length;
    const wrongCount = qaLogs.filter(
      (l) =>
        l.evaluation_status === "wrong" ||
        l.evaluation_status === "unanswered" ||
        !l.evaluation_status
    ).length;

    const totalScoreSum = qaLogs.reduce(
      (acc, l) => acc + (typeof l.score === "number" ? l.score : 0),
      0
    );
    const overallScore =
      session.technical_score !== null && session.technical_score !== undefined
        ? session.technical_score
        : Math.round(totalScoreSum / (totalQuestions || 1));

    const defaultSummary =
      overallScore >= 75
        ? `Strong technical performance across ${
            session.target_company || "target"
          } stack. Solid grasp of core architectural concepts and problem-solving.`
        : overallScore >= 50
        ? `Moderate technical understanding demonstrated. Review the recommended correct solutions below to address gaps in implementation depth.`
        : `Needs technical reinforcement in core algorithms and stack best practices before interview readiness.`;

    return {
      session: {
        id: session.id,
        targetCompany: session.target_company,
        jobRole: session.job_role,
        expertiseLevel: session.expertise_level,
        status: session.status,
      },
      overallScore,
      summary: summaryText || defaultSummary,
      totalQuestions,
      correctCount,
      partiallyCorrectCount,
      wrongCount,
      evaluations: qaLogs.map((log) => ({
        qaId: log.id,
        questionNumber: log.question_number,
        questionText: log.question_text,
        userAnswer: log.user_answer_text || "No answer provided.",
        status: log.evaluation_status || "wrong",
        score:
          typeof log.score === "number"
            ? log.score
            : log.evaluation_status === "correct"
            ? 90
            : log.evaluation_status === "partially_correct"
            ? 55
            : 20,
        feedback:
          log.feedback ||
          "Review your response against the recommended technical solution below.",
        correctAnswer:
          log.correct_answer ||
          "The ideal technical solution should address core architecture and efficiency trade-offs.",
        category: log.category || `Technical Question #${log.question_number}`,
      })),
    };
  }

  static async fallbackEvaluation(session, qaLogs) {
    for (const log of qaLogs) {
      const hasAnswer =
        log.user_answer_text && log.user_answer_text.trim().length > 15;
      const status = hasAnswer ? "partially_correct" : "wrong";
      const score = hasAnswer ? 60 : 20;
      const feedback = hasAnswer
        ? "Answer provides some technical points but requires more depth and precision."
        : "No answer or insufficient explanation provided for this question.";
      const correctAnswer = `The recommended solution should cover core system mechanics, architecture trade-offs, and best practices for ${session.job_role}.`;

      if (!log.evaluation_status) {
        await InterviewModel.updateQAEvaluation(log.id, {
          evaluationStatus: status,
          score,
          feedback,
          correctAnswer,
        });
        log.evaluation_status = status;
        log.score = score;
        log.feedback = feedback;
        log.correct_answer = correctAnswer;
      }
    }

    return this.formatSummaryResponse(session, qaLogs);
  }
}

module.exports = TechnicalEvaluationService;
