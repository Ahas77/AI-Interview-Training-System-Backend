# Thenuha's C3: coaching and progress

You can develop and demonstrate C3 now. You do not have to wait for C1/C2 to finish. They eventually supply questions, answers and delivery readings through the existing integration contract. Your research contribution is the personal comparison and explainable coaching loop.

## What the three features mean

| Feature | Simple explanation | Implementation |
| --- | --- | --- |
| Per-question-type analysis | Show which kinds of questions need more practice. | Group saved answers into HR, technical, behavioral and situational questions. Show average answer score and delivery deviation separately. Require 3 answers per category before identifying the lowest-scoring category. |
| Baseline-relative progress | Compare the student with their own normal delivery. | Record a relaxed warm-up. For each indicator calculate its mean and spread. Deviation = (interview mean - baseline mean) / baseline spread. Average absolute deviations to get delivery distance. |
| Baseline drift | Detect a repeated change rather than one unusual answer. | After 4 completed interviews, compare up to 3 early sessions with the latest 2, using separate windows. Both recent sessions must cross 1.5 reference standard deviations in the same direction. |
| XAI micro-coaching | Give one small action and show why it was suggested. | Select up to 3 evidence-based findings; Grok writes a tip and exercise. The app supplies the measured explanation directly. Track whether the student tried it and what changed in later interviews. |

Example: warm-up gaze-away mean 0.2, spread 0.1, interview mean 0.4. The deviation is 2.0. A tip can suggest placing notes near the camera and show those exact measurements. This is an estimated delivery change, not proof of nervousness or a poor answer.

You do not need to train a neural network, use SHAP, or build a large ML pipeline for this implementation. The explainability is a transparent rule and its supporting numbers. This is not a claim to explain Grok's internal reasoning.

## Run it

1. Keep your existing backend `.env`. Add `XAI_API_KEY` and optionally `C3_XAI_MODEL` / `C3_XAI_VISION_MODEL` from `.env.example`. Never put the key in React, Git, or a screenshot. Grok and Groq are different services.
2. Start MySQL, then run `npm run dev` in the backend. Startup adds C3 tables and missing columns, including `answer_feedback` and `coaching_tips.baseline_version`.
3. Run `npm run dev` in the frontend. It currently connects to `http://localhost:8000/api`.
4. Sign in, visit `/progress/warmup`, and opt into Grok camera coaching. Speak naturally for about a minute for each prompt. The app sends a small JPEG periodically and stores the numeric gaze/head-direction estimates; it does not save the image. At least 3 valid readings are required per indicator; the displayed confidence describes reading coverage, not validated model accuracy.
5. Finish the warm-up and complete an interview. Enable camera coaching in the interview too if you want comparable delivery readings. Each question needs at least 3 readings to display delivery deviation, so short answers may have insufficient signal. Answer content is scored separately using Grok.
6. Visit `/progress` for interview history, progress, category analysis and drift. History and answer scores remain available without a baseline.
7. Open a session. For earlier unscored answers, click **Analyse saved answers**. Then click **Generate coaching**, open **Why this tip?**, and use `/coaching` to record whether you tried the tip. Outcomes wait for later completed interviews of the matching question type.

The exact coaching route is defined in the frontend `App.tsx`; the navigation also links to it. Refreshing the baseline creates a new version from recent completed sessions. Old delivery tips remain open after the baseline changes because their distances cannot be fairly compared across baseline versions. Historical charts are recalculated against the current active baseline for a consistent comparison.

## How AI is used

- C3 calls xAI's Responses API with `store: false`; it does not silently forward candidate data to another provider. See [xAI image input documentation](https://docs.x.ai/developers/model-capabilities/images/understanding). Models are configurable because account access and available models can change.
- Answer rubric: relevance, correctness, specific evidence/examples, and clarity/structure, each worth 25 points. The total is out of 100. These are AI estimates for practice, not validated grading or hiring decisions.
- If Grok is unavailable, the answer stays saved and unscored. You can retry analysis later. Existing measured findings still get a local, rule-based exercise.
- Camera output covers visible gaze/head direction only. A single frame cannot reliably establish a person's real emotional state. It does not measure voice pace or pauses. C1/C2 can supply their actual voice metrics later.
- Images leave the browser only after the camera-coaching checkbox is enabled. An already submitted request may finish after you pause it. The app stores indicators, not image files; provider handling is governed by xAI's terms.
- Mock-reading switches have been removed from the interview UI. The existing `npm run seed:c3` creates clearly labelled synthetic demo accounts; do not treat those as research participants or measured AI accuracy. It currently seeds four participants, so it cannot satisfy the five-participant correlation requirement.

## Contract for your teammates

Authenticated `POST /api/c3/signals`:

```json
{
  "sessionId": 12,
  "qaId": 41,
  "readings": [
    { "t_sec": 45.2, "source": "voice", "metrics": { "pause_ratio": 0.24 } }
  ]
}
```

`t_sec` is seconds since the session began. `qaId` must belong to that session; use null only for warm-up/session-wide readings. Metric names, units and source must remain consistent across warm-up and interviews. Send numeric values, omit unavailable metrics, and never replace missing readings with zero. Browser word count/character count are excluded from delivery comparisons. C3 currently accepts arbitrary numeric metric names, so agree a shared metric dictionary before combining C1/C2. Avoid sending the same indicator from multiple providers under the same name.

Completed sessions and their `interview_qa_logs` supply question text, type, answer, score and timestamps. Live questions get a provisional rule-based category; successful Grok answer evaluation refines it. Existing scored records are preserved by **Analyse saved answers**.

## Evaluation for your degree

Use consenting students to try several interviews. Ask them to rate tip clarity/usefulness and perceived improvement. Compare their ratings with baseline-relative progress and answer-score changes. Report sample size, missing signals, camera/lighting variation, AI grading errors and cases where feedback was unhelpful. Have a human review a sample of scores and tips. A working API integration alone does not demonstrate research novelty or accuracy; confirm the contribution and evaluation expectations with your supervisor.

The admin export uses per-session progress and one latest rated observation per participant for the correlation summary, with at least five eligible participants. Correlation indicates association, not that coaching caused improvement. Demo data is excluded by default.

## Verification

Backend: `npm test`. Tests mock Grok responses and data access, so they incur no API charges. Frontend: `npm run build`; focused ESLint checks cover the changed C3 files. A live Grok key and camera are still required to check real image quality and account-specific model access.

The supplied `TAF_J26_IT_322.pdf` describes a cardiovascular project. It was not used as the specification for this interview system; this guide follows the C3 responsibilities in your message.
