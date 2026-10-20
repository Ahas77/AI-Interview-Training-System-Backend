const axios = require("axios");
const crypto = require("crypto");
const { URL } = require("url");
const AIProvider = require("./ai/aiProvider");

/**
 * Job Posting Extractor Service
 * Handles SSRF-safe URL fetching, HTML text extraction, SHA-256 hashing, and AI-grounded requirement extraction.
 */
class JobPostingExtractorService {
  /**
   * Validate URL against SSRF vulnerabilities
   */
  static isSafeUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return false;
      }

      const hostname = parsed.hostname.toLowerCase();

      // Block localhost, loopbacks, internal hostnames
      if (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname.endsWith(".local") ||
        hostname.endsWith(".internal")
      ) {
        return false;
      }

      // Block private IPv4 ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x AWS metadata)
      const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
      if (ipMatch) {
        const first = parseInt(ipMatch[1], 10);
        const second = parseInt(ipMatch[2], 10);

        if (first === 10) return false;
        if (first === 127) return false;
        if (first === 169 && second === 254) return false; // Cloud metadata
        if (first === 192 && second === 168) return false;
        if (first === 172 && second >= 16 && second <= 31) return false;
        if (first === 0) return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fetch and clean HTML from public job posting URL
   */
  static async fetchJobHtml(url) {
    if (!this.isSafeUrl(url)) {
      throw new Error(`Invalid or disallowed URL for SSRF security: ${url}`);
    }

    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      timeout: 12000,
      maxContentLength: 5 * 1024 * 1024, // 5MB limit
    });

    const rawHtml = response.data || "";
    return this.cleanHtmlToText(rawHtml);
  }

  /**
   * Clean HTML into readable plain text, removing script/style/nav/footer noise
   */
  static cleanHtmlToText(html) {
    if (typeof html !== "string") return "";

    let text = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, " ")
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, " ")
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, " ")
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ");

    // Preserve linebreaks for block tags
    text = text
      .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|tr|br)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n\n")
      .trim();

    return text;
  }

  /**
   * Compute SHA-256 hash of cleaned text for deduplication
   */
  static computeContentHash(text) {
    return crypto.createHash("sha256").update(text.trim()).digest("hex");
  }

  /**
   * AI Extraction: Extract structured technical requirements grounded strictly in source evidence
   */
  static async extractRequirementsWithAI({ rawJobText, companyName, targetJobRole, sourceUrl }) {
    if (!rawJobText || rawJobText.length < 100) {
      throw new Error("Job description text is too short or empty for AI extraction.");
    }

    // Limit text to first 12,000 chars to fit prompt limits while capturing full JD
    const trimmedText = rawJobText.slice(0, 12000);

    const systemPrompt = `You are an expert Technical Hiring Intelligence Analyst.
Analyze the provided real job description text and extract explicit technical hiring requirements.

CRITICAL ZERO-HALLUCINATION RULES:
1. ONLY extract technologies, languages, databases, cloud tools, frameworks, and skills that are EXPLICITLY MENTIONED in the job description.
2. NEVER invent, guess, or assume unmentioned skills.
3. Every single extracted requirement MUST include an "evidence_excerpt" containing the exact sentence from the text.
4. Categorize each requirement into: 'language', 'framework', 'database', 'cloud', 'architecture', 'security', 'devops', or 'tools'.
5. Mark requirement_type as 'required' (must-have/mandatory) or 'preferred' (nice-to-have/plus).
6. Return valid JSON strictly matching the requested schema.`;

    const userPrompt = `Target Company: ${companyName}
Target Role: ${targetJobRole}
Source URL: ${sourceUrl}

=== RAW JOB DESCRIPTION TEXT ===
${trimmedText}
=== END RAW TEXT ===

Output JSON format:
{
  "job_title": "Clean official title from posting",
  "location": "Location from posting (or Remote / Any)",
  "seniority_level": "Beginner | Intermediate | Senior | Lead",
  "experience_years": 3,
  "summary": "Brief 2-sentence summary of the role",
  "requirements": [
    {
      "category": "language | framework | database | cloud | architecture | security | devops | tools",
      "name": "Exact Technology Name (e.g. Java, React, PostgreSQL, Docker, AWS)",
      "type": "required | preferred",
      "description": "Brief description of how it is used in the role",
      "evidence_excerpt": "Exact quotation from the text mentioning this skill"
    }
  ]
}`;

    const parsedResult = await AIProvider.generateJSON(systemPrompt, userPrompt);
    return parsedResult;
  }
}

module.exports = JobPostingExtractorService;
