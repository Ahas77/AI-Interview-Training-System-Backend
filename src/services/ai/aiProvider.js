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
          return await this.callXAI(apiKey, systemPrompt, userPrompt);
        } else if (apiKey.startsWith("gsk_")) {
          return await this.callGroq(apiKey, systemPrompt, userPrompt);
        } else if (apiKey.startsWith("AIza")) {
          return await this.callGemini(apiKey, systemPrompt, userPrompt);
        } else {
          return await this.callGroq(apiKey, systemPrompt, userPrompt).catch(() =>
            this.callXAI(apiKey, systemPrompt, userPrompt)
          );
        }
      } catch (err) {
        console.warn("⚠️ Configured API key call failed, falling back to Real-Time LLM Service:", err.message);
      }
    }

    // Always fallback to Free Real-Time LLM endpoint for 100% unscripted AI generation!
    return await this.callFreeLLM(systemPrompt, userPrompt);
  }

  /**
   * Free Real-Time LLM Provider
   */
  static async callFreeLLM(systemPrompt, userPrompt) {
    // Attempt 1: Pollinations POST API with openai model
    try {
      const payload = {
        messages: [
          { role: "system", content: `${systemPrompt}\nReturn valid JSON strictly: {"question": "..."}` },
          { role: "user", content: userPrompt },
        ],
        model: "openai",
        jsonMode: true,
      };

      const res = await axios.post("https://text.pollinations.ai/", payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 15000,
      });

      if (res.data) {
        const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
        if (text.includes("question")) return text;
      }
    } catch (e) {
      // Ignore & try GET method
    }

    // Attempt 2: Pollinations GET API
    try {
      const combined = `${systemPrompt}\n${userPrompt}\nReturn JSON format: {"question": "..."}`;
      const encoded = encodeURIComponent(combined);
      const res = await axios.get(`https://text.pollinations.ai/${encoded}?model=qwen&json=true`, {
        timeout: 15000,
      });

      if (res.data) {
        const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
        return text;
      }
    } catch (e) {
      console.error("Free LLM fallback error:", e.message);
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
   * Call Groq API with automatic model fallback
   */
  static async callGroq(apiKey, systemPrompt, userPrompt) {
    const url = "https://api.groq.com/openai/v1/chat/completions";
    const models = [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "llama3-8b-8192",
      "mixtral-8x7b-32768",
    ];

    let lastError = null;
    for (const model of models) {
      try {
        const payload = {
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
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
