const axios = require("axios");

/**
 * Company Job Search Service
 * Real-time discovery of live job postings from official careers pages, ATS domains, and public search.
 * Zero hardcoded companies or technical stacks.
 */
class CompanyJobSearchService {
  /**
   * Search for live job postings matching company, role, seniority, and location
   */
  static async searchJobPostings({ company, jobRole, seniority = "Intermediate", location = "" }) {
    if (!company || !company.trim()) {
      return [];
    }

    const cleanCompany = company.trim();
    const cleanRole = (jobRole || "Software Engineer").trim();
    const cleanLocation = (location || "").trim();

    const candidateResults = [];
    const queries = this.buildSearchQueries(cleanCompany, cleanRole, seniority, cleanLocation);

    for (const query of queries) {
      try {
        const results = await this.executeBingSearch(query, cleanCompany);
        if (results && results.length > 0) {
          for (const item of results) {
            if (!candidateResults.some((r) => r.url === item.url)) {
              candidateResults.push(item);
            }
          }
        }
        if (candidateResults.length >= 6) break;
      } catch (err) {
        console.warn(`Search discovery warning for query [${query}]:`, err.message);
      }
    }

    return candidateResults;
  }

  /**
   * Dynamically build search queries across priority sources
   */
  static buildSearchQueries(company, role, seniority, location) {
    const locPart = location && location !== "Any" && location !== "Remote" ? ` ${location}` : "";

    return [
      // Priority 1: ATS platforms
      `site:greenhouse.io OR site:lever.co OR site:myworkdayjobs.com OR site:smartrecruiters.com "${company}" "${role}"`,
      // Priority 2: Official Careers page
      `"${company}" careers "${role}" job description requirements${locPart}`,
      // Priority 3: General authoritative hiring posts
      `"${company}" hiring "${role}" qualifications responsibilities${locPart}`,
    ];
  }

  /**
   * Execute search request via public search endpoint with decoded clean URLs
   */
  static async executeBingSearch(query, targetCompany) {
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;

    const response = await axios.get(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 10000,
    });

    const html = response.data || "";
    const results = [];
    const matches = [...html.matchAll(/<h2><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/gi)];

    for (const match of matches) {
      const rawHref = match[1];
      const title = this.cleanHtml(match[2]);
      let finalUrl = rawHref;

      // Decode base64 URL from Bing redirect links if present
      const uMatch = rawHref.match(/(?:&amp;|&|\?)u=a1([^&]+)/);
      if (uMatch) {
        try {
          finalUrl = Buffer.from(uMatch[1], "base64").toString("utf-8");
        } catch (e) {
          finalUrl = rawHref;
        }
      }

      if (!finalUrl || !finalUrl.startsWith("http")) continue;

      // Filter out pure search engines, wikis, social, documentation, or code repos
      if (/bing\.com|google\.com|yahoo\.com|duckduckgo\.com|wikipedia\.org|github\.com|youtube\.com|twitter\.com|facebook\.com|instagram\.com/i.test(finalUrl)) {
        continue;
      }

      // Check if URL or title indicates a career or job posting
      const isJobUrl = /(?:careers|jobs|job|vacancy|openings|position|work-with-us|lever\.co|greenhouse\.io|myworkdayjobs|smartrecruiters|ashbyhq)/i.test(finalUrl);
      const isJobTitle = /(?:engineer|developer|architect|lead|intern|analyst|specialist|manager|hiring|careers|job)/i.test(title);

      if (!isJobUrl && !isJobTitle) {
        continue;
      }

      // Avoid root domain homepages
      try {
        const parsed = new URL(finalUrl);
        if (parsed.pathname === "/" || parsed.pathname === "") {
          continue;
        }
      } catch {
        continue;
      }

      let sourceType = "public_listing";
      if (/greenhouse\.io|lever\.co|myworkdayjobs\.com|smartrecruiters\.com|ashbyhq\.com/i.test(finalUrl)) {
        sourceType = "ats_portal";
      } else if (/careers|jobs|about\/careers/i.test(finalUrl)) {
        sourceType = "official_careers";
      }

      results.push({
        title,
        url: finalUrl,
        snippet: title,
        sourceType,
      });

      if (results.length >= 3) break;
    }

    return results;
  }

  /**
   * Strip HTML tags from strings
   */
  static cleanHtml(str) {
    return str
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }
}

module.exports = CompanyJobSearchService;
