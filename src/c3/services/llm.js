const AIProvider = require("../../services/ai/aiProvider");
const { LLM_TIMEOUT_MS } = require("../config/thresholds");

async function generateJSON(system, input) {
  // Call the shared provider only with C3's numeric findings, never credentials or raw interview answers.
  let timeout;
  try {
    const result = await Promise.race([
      AIProvider.generateJSON(system, JSON.stringify(input)),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("C3 coaching timeout")), LLM_TIMEOUT_MS); }),
    ]);
    const parsed = typeof result === "string" ? JSON.parse(result.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()) : result;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid coaching JSON");
    return parsed;
  } finally { clearTimeout(timeout); }
}
module.exports = { generateJSON };
