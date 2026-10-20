const axios = require("axios");

/**
 * AI Provider Abstraction
 * Supports Groq API, xAI Grok API, Gemini API, OpenAI, and Free Real-Time LLM Fallback.
 */
class AIProvider {
  /**
   * Call the configured AI provider with system and user prompts requiring JSON output.
   */
  static async generateJSON(systemPrompt, userPrompt) {
    let rawOutput = null;
    const apiKey = (
      process.env.GROQ_API_KEY ||
      process.env.XAI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      ""
    ).trim();

    if (apiKey) {
      try {
        if (apiKey.startsWith("xai-")) {
          rawOutput = await this.callXAI(apiKey, systemPrompt, userPrompt);
        } else if (apiKey.startsWith("gsk_")) {
          rawOutput = await this.callGroq(apiKey, systemPrompt, userPrompt);
        } else if (apiKey.startsWith("AIza")) {
          rawOutput = await this.callGemini(apiKey, systemPrompt, userPrompt);
        } else {
          rawOutput = await this.callGroq(apiKey, systemPrompt, userPrompt).catch(() =>
            this.callXAI(apiKey, systemPrompt, userPrompt)
          );
        }
      } catch (err) {
        console.warn("⚠️ Configured API key call failed, falling back to Real-Time LLM Service:", err.message);
      }
    }

    if (!rawOutput) {
      rawOutput = await this.callFreeLLM(systemPrompt, userPrompt);
    }

    if (typeof rawOutput === "object" && rawOutput !== null) {
      return rawOutput;
    }

    if (typeof rawOutput === "string") {
      try {
        const jsonMatch = rawOutput.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || rawOutput.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[1] || jsonMatch[0]);
        }
        return JSON.parse(rawOutput);
      } catch (e) {
        return { text: rawOutput };
      }
    }

    return rawOutput || {};
  }

  /**
   * Free Real-Time LLM Provider
   */
  static async callFreeLLM(systemPrompt, userPrompt) {
    try {
      const payload = {
        messages: [
          { role: "system", content: `${systemPrompt}\nOutput strict valid JSON only.` },
          { role: "user", content: typeof userPrompt === "string" ? userPrompt.slice(0, 4000) : JSON.stringify(userPrompt).slice(0, 4000) },
        ],
        jsonMode: true,
      };

      const res = await axios.post("https://text.pollinations.ai/", payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 20000,
      });

      if (res.data) {
        return res.data;
      }
    } catch (e) {
      // Try secondary model
    }

    try {
      const res = await axios.post(
        "https://text.pollinations.ai/",
        {
          messages: [
            {
              role: "user",
              content: `${systemPrompt}\n\n${typeof userPrompt === "string" ? userPrompt.slice(0, 3000) : ""}\n\nOutput valid JSON strictly.`,
            },
          ],
          jsonMode: true,
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 20000,
        }
      );

      if (res.data) return res.data;
    } catch (e) {
      console.warn("Free LLM fallback failed:", e.message);
    }

    return null;
  }

  /**
   * Call xAI (Grok API) with model fallbacks
   */
  static async callXAI(apiKey, systemPrompt, userPrompt) {
    const url = "https://api.x.ai/v1/chat/completions";
    const models = ["grok-beta", "grok-2-latest", "grok-2-1212"];

    let lastError = null;
    for (const model of models) {
      try {
        const payload = {
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
        };

        const res = await axios.post(url, payload, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 25000,
        });

        const content = res.data?.choices?.[0]?.message?.content;
        if (content) return content;
      } catch (err) {
        lastError = err.response?.data?.error?.message || err.message;
      }
    }

    throw new Error(`xAI Grok API error: ${lastError}`);
  }

  /**
   * Dynamically fetch available chat models for the Groq API key
   */
  static async getGroqModels(apiKey) {
    if (this._groqModelsCache && Date.now() - this._groqModelsTime < 3600000) {
      return this._groqModelsCache;
    }

    try {
      const res = await axios.get("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 5000,
      });

      if (res.data?.data && Array.isArray(res.data.data)) {
        // Filter out non-chat models (audio transcription, guardrails, etc.)
        const chatModels = res.data.data
          .filter(
            (m) =>
              m.active !== false &&
              !m.id.includes("whisper") &&
              !m.id.includes("guard")
          )
          .map((m) => m.id);

        if (chatModels.length > 0) {
          this._groqModelsCache = chatModels;
          this._groqModelsTime = Date.now();
          return chatModels;
        }
      }
    } catch (e) {
      // Fallback silently to static list
    }

    return [
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "qwen/qwen3.8-27b",
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
    ];
  }

  /**
   * Call Groq API with automatic model fallback
   */
  static async callGroq(apiKey, systemPrompt, userPrompt) {
    const url = "https://api.groq.com/openai/v1/chat/completions";
    const models = await this.getGroqModels(apiKey);

    // Groq requires the word 'json' in system or user prompt when using json_object format
    const safeSystemPrompt = systemPrompt.toLowerCase().includes("json")
      ? systemPrompt
      : `${systemPrompt}\nOutput strict valid JSON format.`;

    let lastError = null;
    for (const model of models) {
      try {
        const payload = {
          model,
          messages: [
            { role: "system", content: safeSystemPrompt },
            { role: "user", content: typeof userPrompt === "string" ? userPrompt : JSON.stringify(userPrompt) },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
        };

        const res = await axios.post(url, payload, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 25000,
        });

        const content = res.data?.choices?.[0]?.message?.content;
        if (content) return content;
      } catch (err) {
        lastError = err.response?.data?.error?.message || err.message;
      }
    }

    throw new Error(`Groq API error: ${lastError}`);
  }

  /**
   * Call Google Gemini API
   */
  static async callGemini(apiKey, systemPrompt, userPrompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const payload = {
      contents: [
        {
          parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.3,
      },
    };

    const res = await axios.post(url, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 25000,
    });

    const content = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (content) return content;

    throw new Error("Gemini API returned empty response");
  }
}

module.exports = AIProvider;
