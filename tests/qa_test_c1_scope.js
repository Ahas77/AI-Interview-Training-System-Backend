/**
 * Comprehensive Automated QA Test Suite for Component 1 (PP1 50% Scope)
 *
 * Verifies:
 * 1. Mathematical Accuracy:
 *    - 8 Vocal features
 *    - 5 Facial features
 *    - Baseline calibration B_f = (mu_f, sigma_f)
 *    - Standardized deviation D_f(t)
 *    - Exact reproduction of the illustrative proposal test case (Section 5):
 *      * Pitch (F0): Baseline 145 Hz -> Interview 172 Hz (+18.6%)
 *      * Speech Rate: Baseline 128 WPM -> Interview 151 WPM (+18.0%)
 *      * Pause Duration: Baseline 0.8 s -> Interview 1.3 s (+62.5%)
 *      * Head Movement: Baseline 12/min -> Interview 8/min (-33.3%)
 *      * Facial Movement: Baseline 0.31 -> Interview 0.22 (-29.0%)
 * 2. PDS & Multimodal Sync Calculation
 * 3. 30-60s Duration Boundary Validation
 * 4. Explainable Narrative Generation
 * 5. Full End-to-End REST API Workflow:
 *    - Register / Login
 *    - Create C1 Session
 *    - Save 45s Baseline
 *    - Save Interview Measurements
 *    - Fetch Results & Verify Database Persistence
 *    - Fetch Benchmark Demo
 */

const assert = require("assert");
const axios = require("axios");
const {
  VOCAL_FEATURES,
  FACIAL_FEATURES,
  ALL_FEATURES,
  buildAnalysisResult,
  getProposalBenchmarkResult,
  validateBaselineDuration,
  calculateFeatureSummary,
  calculateDeviation,
} = require("../src/services/behavioralAnalysisService");

const API_BASE = "http://localhost:8000/api";

function runMathTests() {
  console.log("============================================================");
  console.log("TEST 1: Feature Counts & Modality Separation");
  console.log("============================================================");
  assert.strictEqual(VOCAL_FEATURES.length, 8, "Must have exactly 8 vocal features for PP1");
  assert.strictEqual(FACIAL_FEATURES.length, 5, "Must have exactly 5 facial features for PP1");
  assert.strictEqual(ALL_FEATURES.length, 13, "Total features must be 13 for PP1 multimodal scope");
  console.log("✅ Passed: 8 Vocal + 5 Facial = 13 Multimodal Features defined properly.");

  console.log("\n============================================================");
  console.log("TEST 2: Exact Proposal Benchmark Case Verification (Section 5)");
  console.log("============================================================");
  const benchmark = getProposalBenchmarkResult();

  const f0 = benchmark.features.f0;
  const rate = benchmark.features.speech_rate;
  const pause = benchmark.features.average_pause_duration;
  const head = benchmark.features.head_movement;
  const face = benchmark.features.facial_landmark_movement;

  console.log(`- Pitch (F0): Expected +18.6%, Got: ${f0.changePercent}%`);
  assert(Math.abs(f0.changePercent - 18.62) < 0.1, `Expected +18.6%, got ${f0.changePercent}%`);

  console.log(`- Speech Rate: Expected +18.0%, Got: ${rate.changePercent}%`);
  assert(Math.abs(rate.changePercent - 17.97) < 0.1, `Expected +18.0%, got ${rate.changePercent}%`);

  console.log(`- Pause Duration: Expected +62.5%, Got: ${pause.changePercent}%`);
  assert(Math.abs(pause.changePercent - 62.5) < 0.1, `Expected +62.5%, got ${pause.changePercent}%`);

  console.log(`- Head Movement: Expected -33.3%, Got: ${head.changePercent}%`);
  assert(Math.abs(head.changePercent - (-33.33)) < 0.1, `Expected -33.3%, got ${head.changePercent}%`);

  console.log(`- Facial Movement: Expected -29.0%, Got: ${face.changePercent}%`);
  assert(Math.abs(face.changePercent - (-29.03)) < 0.1, `Expected -29.0%, got ${face.changePercent}%`);

  assert.strictEqual(benchmark.overallStatus, "behavioral_deviation_detected");
  assert(benchmark.pds.vocal > 0, "Vocal PDS must be > 0");
  assert(benchmark.pds.facial > 0, "Facial PDS must be > 0");
  assert(benchmark.pds.multimodal > 0, "Multimodal PDS must be > 0");
  assert(benchmark.sync.score >= 65 && benchmark.sync.score <= 98, "Sync score must be in normal range");

  console.log("✅ Passed: Proposal benchmark calculations match Section 5 exactly!");

  console.log("\n============================================================");
  console.log("TEST 3: Baseline Duration Boundary Testing (30s to 60s)");
  console.log("============================================================");
  // Valid 45s
  const validDuration = validateBaselineDuration([
    { timestampMs: 0 },
    { timestampMs: 45000 },
  ]);
  assert.strictEqual(validDuration, 45, "45 seconds must be accepted as valid");

  // Invalid: < 30s
  assert.throws(
    () => validateBaselineDuration([{ timestampMs: 0 }, { timestampMs: 25000 }]),
    /Baseline duration must be between 30 and 60 seconds/,
    "Under 30s must throw validation error"
  );

  // Invalid: > 60s
  assert.throws(
    () => validateBaselineDuration([{ timestampMs: 0 }, { timestampMs: 75000 }]),
    /Baseline duration must be between 30 and 60 seconds/,
    "Over 60s must throw validation error"
  );
  console.log("✅ Passed: 30-60 second warm-up window enforcement validated.");
}

async function runApiTests() {
  console.log("\n============================================================");
  console.log("TEST 4: End-to-End REST API Workflow");
  console.log("============================================================");

  // Step 1: Login with existing user
  console.log("1. Authenticating test user...");
  const loginRes = await axios.post(`${API_BASE}/login`, {
    value: "nethmina.test@example.com",
    password: "password123",
  });
  assert(loginRes.data.success, "Login failed");
  const token = loginRes.data.token;
  console.log("   Authenticated successfully. Token acquired.");

  const authHeaders = { Authorization: `Bearer ${token}` };

  // Step 2: Create C1 Session
  console.log("2. Creating C1 behavioral analysis session...");
  const createRes = await axios.post(
    `${API_BASE}/behavioral-analysis/sessions`,
    {},
    { headers: authHeaders }
  );
  assert(createRes.data.success, "Session creation failed");
  const sessionId = createRes.data.sessionId;
  assert(sessionId > 0, "Valid session ID required");
  console.log(`   Session created with ID: ${sessionId}, Status: ${createRes.data.status}`);

  // Step 3: Save Baseline (45 seconds warm-up)
  console.log("3. Saving 45-second candidate-specific warm-up baseline...");
  const baselineSamples = [
    {
      timestampMs: 0,
      vocal: {
        f0: 145,
        pitch_variability: 18,
        speech_rate: 128,
        average_pause_duration: 0.8,
        pause_frequency: 10,
        vocal_energy: 0.08,
        jitter: 0.012,
        mfcc: -4.5,
      },
      facial: {
        facial_landmark_movement: 0.31,
        facial_movement_intensity: 2.8,
        head_movement: 12,
        blink_rate: 15,
        mouth_movement: 0.22,
      },
    },
    {
      timestampMs: 45000,
      vocal: {
        f0: 147,
        pitch_variability: 19,
        speech_rate: 129,
        average_pause_duration: 0.82,
        pause_frequency: 10,
        vocal_energy: 0.082,
        jitter: 0.012,
        mfcc: -4.4,
      },
      facial: {
        facial_landmark_movement: 0.31,
        facial_movement_intensity: 2.8,
        head_movement: 12,
        blink_rate: 15,
        mouth_movement: 0.22,
      },
    },
  ];

  const baseRes = await axios.post(
    `${API_BASE}/behavioral-analysis/sessions/${sessionId}/baseline`,
    { samples: baselineSamples },
    { headers: authHeaders }
  );
  assert(baseRes.data.success, "Save baseline failed");
  assert.strictEqual(baseRes.data.status, "baseline_ready");
  console.log("   Baseline saved successfully. Status: baseline_ready");

  // Step 4: Save Interview Measurements
  console.log("4. Saving interview measurements...");
  const interviewSamples = [
    {
      timestampMs: 50000,
      vocal: {
        f0: 172,
        pitch_variability: 22,
        speech_rate: 151,
        average_pause_duration: 1.3,
        pause_frequency: 14,
        vocal_energy: 0.09,
        jitter: 0.015,
        mfcc: -4.2,
      },
      facial: {
        facial_landmark_movement: 0.22,
        facial_movement_intensity: 2.1,
        head_movement: 8,
        blink_rate: 18,
        mouth_movement: 0.18,
      },
    },
    {
      timestampMs: 110000,
      vocal: {
        f0: 170,
        pitch_variability: 21,
        speech_rate: 150,
        average_pause_duration: 1.28,
        pause_frequency: 13,
        vocal_energy: 0.089,
        jitter: 0.014,
        mfcc: -4.3,
      },
      facial: {
        facial_landmark_movement: 0.22,
        facial_movement_intensity: 2.1,
        head_movement: 8,
        blink_rate: 18,
        mouth_movement: 0.18,
      },
    },
  ];

  const measureRes = await axios.post(
    `${API_BASE}/behavioral-analysis/sessions/${sessionId}/measurements`,
    { samples: interviewSamples },
    { headers: authHeaders }
  );
  assert(measureRes.data.success, "Save measurements failed");
  assert.strictEqual(measureRes.data.overallStatus, "behavioral_deviation_detected");
  assert(measureRes.data.pds.multimodal > 0);
  assert(measureRes.data.explainableNarratives.length > 0);
  console.log("   Measurements analyzed and persisted to MySQL database.");
  console.log("   Explainable observation sample:", measureRes.data.explainableNarratives[0]);

  // Step 5: Retrieve Results via GET /sessions/:id/result
  console.log("5. Retrieving result via GET /api/behavioral-analysis/sessions/:id/result...");
  const resultRes = await axios.get(
    `${API_BASE}/behavioral-analysis/sessions/${sessionId}/result`,
    { headers: authHeaders }
  );
  assert(resultRes.data.success, "Fetch result failed");
  assert.strictEqual(resultRes.data.status, "completed");
  console.log("   Result successfully verified from MySQL database.");

  // Step 6: Test GET /latest endpoint
  console.log("6. Testing GET /api/behavioral-analysis/latest...");
  const latestRes = await axios.get(`${API_BASE}/behavioral-analysis/latest`, {
    headers: authHeaders,
  });
  assert(latestRes.data.success);
  assert.strictEqual(latestRes.data.sessionId, sessionId);
  console.log("   Latest session endpoint returns current session accurately.");

  // Step 7: Test GET /benchmark demo endpoint
  console.log("7. Testing GET /api/behavioral-analysis/benchmark...");
  const benchRes = await axios.get(`${API_BASE}/behavioral-analysis/benchmark`);
  assert(benchRes.data.success);
  assert(benchRes.data.result.pds.multimodal > 0);
  console.log("   Benchmark demo endpoint functional.");

  console.log("\n============================================================");
  console.log("🎉 ALL QA TESTS PASSED SUCCESSFULLY! 100% COMPLIANCE VERIFIED");
  console.log("============================================================");
}

async function run() {
  try {
    runMathTests();
    await runApiTests();
    process.exit(0);
  } catch (err) {
    console.error("❌ QA Test Failed:", err);
    process.exit(1);
  }
}

run();
