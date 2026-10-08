const AIProvider = require("./ai/aiProvider");

const SYSTEM_PROMPT = `
You are an expert AI Resume Parser specialized exclusively in the IT & Software Engineering Industry. You analyze raw curriculum vitae (CV) text for IT professionals (Software Engineers, Frontend/Backend/Full Stack Developers, DevOps/Cloud Engineers, QA/Automation Engineers, Data Engineers, AI/ML Engineers, Mobile Developers, System Architects, Security Engineers, UI/UX Engineers) and extract comprehensive, structured technical information in strict JSON format.


RULES:
1. Do NOT hallucinate or invent information. Every piece of data must be directly supported by the CV text.
2. If a scalar field is missing or not mentioned, return null.
3. If an array field is missing or not mentioned, return [].
4. Return ONLY valid, strictly-formatted JSON conforming to the schema below without markdown commentary.
5. "expertise_level" MUST be one of: "Intern", "Junior", "Mid-Level", "Senior", "Lead", "Manager", or null. Do not invent seniority.
6. "suggested_job_roles" MUST contain realistic IT job roles explicitly supported by the CV (e.g. ["Software Engineer", "Full Stack Developer", "Backend Engineer", "Frontend Engineer", "DevOps Engineer", "QA Engineer", "Mobile Developer", "Data Engineer"]).
7. Focus sharply on tech stacks, programming languages, frameworks, databases, cloud providers, DevOps tools, architectural patterns, and IT project responsibilities.




JSON SCHEMA TO RETURN:
{
  "candidate": {
    "full_name": string | null,
    "email": string | null,
    "phone": string | null,
    "location": string | null,
    "linkedin": string | null,
    "github": string | null,
    "portfolio": string | null
  },
  "professional_summary": string | null,
  "skills": [string],
  "technical_skills": [string],
  "soft_skills": [string],
  "tools_and_frameworks": [string],
  "databases_and_cloud": [string],
  "experience_years": number | null,
  "expertise_level": string | null,
  "suggested_job_roles": [string],
  "education": [
    {
      "degree": string | null,
      "institution": string | null,
      "year": string | null,
      "details": string | null
    }
  ],
  "work_experience": [
    {
      "job_title": string | null,
      "company": string | null,
      "location": string | null,
      "start_date": string | null,
      "end_date": string | null,
      "responsibilities": [string]
    }
  ],
  "projects": [
    {
      "title": string | null,
      "description": string | null,
      "technologies": [string]
    }
  ],
  "certifications": [string],
  "languages": [string],
  "achievements": [string],
  "publications": [string],
  "volunteer_work": [string],
  "custom_sections": [
    {
      "section_title": string,
      "items": [string]
    }
  ],
  "keywords": [string]
}
`;

/**
 * Clean markdown JSON wrappers if returned by AI
 */
function cleanJSONString(str) {
  if (!str) return "";
  let cleaned = str.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }
  return cleaned.trim();
}

/**
 * Ensure parsed data conforms to expected schema defaults
 */
function normalizeParsedData(data) {
  const normalized = {
    candidate: {
      full_name: data?.candidate?.full_name || null,
      email: data?.candidate?.email || null,
      phone: data?.candidate?.phone || null,
      location: data?.candidate?.location || null,
      linkedin: data?.candidate?.linkedin || null,
      github: data?.candidate?.github || null,
      portfolio: data?.candidate?.portfolio || null,
    },
    professional_summary: data?.professional_summary || null,
    skills: Array.isArray(data?.skills) ? data.skills : [],
    technical_skills: Array.isArray(data?.technical_skills) ? data.technical_skills : [],
    soft_skills: Array.isArray(data?.soft_skills) ? data.soft_skills : [],
    tools_and_frameworks: Array.isArray(data?.tools_and_frameworks) ? data.tools_and_frameworks : [],
    databases_and_cloud: Array.isArray(data?.databases_and_cloud) ? data.databases_and_cloud : [],
    experience_years: typeof data?.experience_years === "number" ? data.experience_years : null,
    expertise_level: data?.expertise_level || null,
    suggested_job_roles: Array.isArray(data?.suggested_job_roles) ? data.suggested_job_roles : [],
    education: Array.isArray(data?.education) ? data.education : [],
    work_experience: Array.isArray(data?.work_experience) ? data.work_experience : [],
    projects: Array.isArray(data?.projects) ? data.projects : [],
    certifications: Array.isArray(data?.certifications) ? data.certifications : [],
    languages: Array.isArray(data?.languages) ? data.languages : [],
    achievements: Array.isArray(data?.achievements) ? data.achievements : [],
    publications: Array.isArray(data?.publications) ? data.publications : [],
    volunteer_work: Array.isArray(data?.volunteer_work) ? data.volunteer_work : [],
    custom_sections: Array.isArray(data?.custom_sections) ? data.custom_sections : [],
    keywords: Array.isArray(data?.keywords) ? data.keywords : [],
  };

  // Combine IT skills if main skills list is empty
  if (normalized.skills.length === 0) {
    normalized.skills = [
      ...new Set([
        ...normalized.technical_skills,
        ...normalized.tools_and_frameworks,
        ...normalized.databases_and_cloud,
        ...normalized.soft_skills,
      ]),
    ];
  }

  return normalized;
}

/**
 * Heuristic fallback parser when AI API is unavailable or key not configured
 */
function heuristicFallbackParse(rawText) {
  if (!rawText) return normalizeParsedData({});

  // 1. Email regex
  const emailMatch = rawText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i);
  const email = emailMatch ? emailMatch[0] : null;

  // 2. Phone (+94 or 10-digit mobile, ignoring 12-digit NIC numbers starting with 200...)
  let phone = null;
  const mobileMatch = rawText.match(/(\+94\s*\d{2}\s*\d{3}\s*\d{4}|\+94\s*\d{9}|07\d{8})/);
  if (mobileMatch) {
    phone = mobileMatch[0].trim();
  } else {
    const phoneList = rawText.match(/\+?\d{1,3}[-.\s]?\(?\d{2,4}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || [];
    const validPhone = phoneList.find(
      (p) => (p.includes("+") || p.startsWith("07") || p.startsWith("01") || p.startsWith("03")) && p.length >= 9 && p.length <= 16
    );
    if (validPhone) phone = validPhone.trim();
  }

  // 3. Dynamic Name Extraction (with strict word boundaries \b)
  let full_name = null;
  const fullNameSection = rawText.match(/\b(?:Full\s*Name|Candidate\s*Name)\b\s*[-:\s]*([A-Za-z\s]{3,60})/i);
  if (fullNameSection && fullNameSection[1]) {
    const cleaned = fullNameSection[1].replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
    if (cleaned.length > 2 && !/diploma|degree|resume|cv|objective|profile/i.test(cleaned)) {
      full_name = cleaned.split("\n")[0].trim();
    }
  }

  const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
  const excludedKeywords = /profile|objective|curriculum|resume|vital|contact|education|experience|skills|projects|undergraduate|engineer|developer|manager|specialist|diploma|degree|university|college|school|hospital|bank|company|ltd|pvt|inc|street|road|wathtta|sri lanka|kurunegala|colombo|kandy|galle|male|female|single|married|nationality|religion|nic|dob|phone|email|gmail|yahoo|linkedin|github|portfolio|http|www|com|org|net|for|and|the|with|from|local|sports|club|cricket|football|tournament|tournaments/i;

  if (!full_name) {
    for (let i = 0; i < Math.min(15, lines.length); i++) {
      const line = lines[i];
      if (line.length >= 3 && line.length <= 45 && !/[\d@:\/\\=,#]/.test(line)) {
        const words = line.split(/\s+/);
        if (words.length >= 1 && words.length <= 5) {
          const isTitleCase = words.every((w) => /^[A-Z][a-zA-Z'.\-]*$/.test(w));
          if (isTitleCase && !excludedKeywords.test(line)) {
            full_name = line;
            break;
          }
        }
      }
    }
  }

  // 4. Dynamic Location / Address Extraction
  let location = null;
  const locationMatch = rawText.match(/(?:Kurunegala|Colombo|Kandy|Galle|Gampaha|Jaffna|Batticaloa|Matara|Negombo|Malabe)(?:\s*,\s*Sri\s*lanka)?/i) ||
                        rawText.match(/(?:No\s*:?\s*\d+[^,\n]+|(?:Address|Location)\s*[-:\s]*[^\n]+)/i);
  if (locationMatch) {
    location = locationMatch[0].replace(/(?:Address|Location)\s*[-:\s]*/i, "").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  }

  // 5. LinkedIn & GitHub Links
  const linkedinMatch = rawText.match(/(https?:\/\/)?(www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/i);
  const linkedin = linkedinMatch ? linkedinMatch[0] : null;

  const githubMatch = rawText.match(/(https?:\/\/)?(www\.)?github\.com\/[a-zA-Z0-9_-]+/i);
  const github = githubMatch ? githubMatch[0] : null;

  const portfolioMatch = rawText.match(/(https?:\/\/)?(www\.)?[a-zA-Z0-9_-]+\.(vercel\.app|netlify\.app|github\.io|me|io|dev)/i);
  const portfolio = portfolioMatch ? portfolioMatch[0] : null;

  // 6. Dynamic Education Extraction
  const education = [];
  const eduRegex = /(SLIIT|Cardiff|BSc|B\.Sc|MSc|M\.Sc|Bachelor|Master|Diploma|Higher Diploma|HND|Diploma in|Associate Degree)[^\n]*/gi;
  let eduMatch;
  while ((eduMatch = eduRegex.exec(rawText)) !== null) {
    const degreeLine = eduMatch[0].trim();
    if (degreeLine.length > 3 && degreeLine.length < 120) {
      education.push({
        degree: degreeLine,
        institution: "Extracted from CV",
        year: null,
      });
    }
  }

  // 7. Dynamic Projects Extraction
  const projects = [];
  const projectRegex = /([A-Za-z0-9\s\(\)-]{4,70})\n(?:This is|Developed|Built|Created|Implemented)[^\n]*\n(?:[^\n]*\n)?(?:Key Technologies|Technologies|Tech Stack):\s*([^\n]+)/gi;
  let projMatch;
  while ((projMatch = projectRegex.exec(rawText)) !== null) {
    const blockLines = projMatch[0].split("\n").filter(Boolean);
    const title = blockLines[0].replace(/COMPLETED PROJECTS|PROJECTS/i, "").trim();
    const techList = projMatch[2].split(",").map((t) => t.trim());
    if (title && title.length > 2) {
      projects.push({
        title,
        description: blockLines.slice(1, -1).join(" ").replace(/(?:Key Technologies|Technologies|Tech Stack):.*/i, "").trim() || title,
        technologies: techList,
      });
    }
  }

  // 8. Tech Skills Matching
  const knownTech = [
    "JavaScript", "TypeScript", "React", "Next.js", "Node.js", "Express", "Python",
    "Java", "C++", "C#", "PHP", "Laravel", "HTML", "CSS", "Tailwind", "Bootstrap", "MySQL",
    "PostgreSQL", "MongoDB", "Firebase", "Docker", "AWS", "Git", "REST API", "GraphQL", "TensorFlow", "Flask", "Angular", "Vue", "Spring", "Django", "MERN", "Figma", "Postman", "Eclipse"
  ];
  const detectedSkills = knownTech.filter((skill) => {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-zA-Z0-9+#])${escaped}(?:$|[^a-zA-Z0-9+#])`, "i").test(rawText);
  });

  // 9. Job Roles & Expertise Level
  const roles = [];
  if (/full\s*stack|mern/i.test(rawText)) roles.push("Full Stack Developer");
  if (/frontend|react|vue|angular|ui\/ux/i.test(rawText)) roles.push("Frontend Engineer");
  if (/backend|node|laravel|express|spring|django/i.test(rawText)) roles.push("Backend Engineer");
  if (/devops|cloud|aws|docker/i.test(rawText)) roles.push("DevOps Engineer");
  if (/qa|testing|automation/i.test(rawText)) roles.push("QA Engineer");
  if (/mobile|flutter|react native|ios|android/i.test(rawText)) roles.push("Mobile Application Developer");
  if (/software\s*engineer|information\s*technology|undergraduate/i.test(rawText)) roles.push("Software Engineer");
  if (roles.length === 0) roles.push("Software Engineer");

  let level = "Junior";
  if (/senior|lead|architect|principal|manager/i.test(rawText)) {
    level = "Senior";
  } else if (/undergraduate|student|intern|entry/i.test(rawText)) {
    level = "Junior";
  } else if (/associate|junior/i.test(rawText)) {
    level = "Junior";
  } else if (/mid|intermediate/i.test(rawText)) {
    level = "Mid-Level";
  }

  return normalizeParsedData({
    candidate: {
      full_name,
      email,
      phone,
      location,
      linkedin,
      github,
      portfolio,
    },
    professional_summary: lines.slice(0, 3).join(" "),
    skills: detectedSkills,
    technical_skills: detectedSkills,
    soft_skills: ["Problem Solving", "Teamwork", "Adaptability", "Time Management", "Leadership"],
    experience_years: /undergraduate|student/i.test(rawText) ? 0 : 2,
    expertise_level: level,
    suggested_job_roles: roles,
    education,
    projects,
  });
}

/**
 * Parse raw CV text using AI provider (or fallback)
 * @param {string} rawText
 * @returns {Promise<object>} Structured parsed data
 */
async function parseResume(rawText) {
  if (!rawText || !rawText.trim()) {
    throw new Error("Cannot parse empty CV text.");
  }

  try {
    const rawAiResponse = await AIProvider.generateJSON(SYSTEM_PROMPT, rawText);

    if (!rawAiResponse) {
      return heuristicFallbackParse(rawText);
    }

    const cleaned = cleanJSONString(rawAiResponse);
    const parsed = JSON.parse(cleaned);

    return normalizeParsedData(parsed);
  } catch (err) {
    console.error("AI Resume parsing error:", err.message);
    // Use fallback parsing on JSON parse failure or AI error
    return heuristicFallbackParse(rawText);
  }
}

module.exports = {
  parseResume,
  normalizeParsedData,
  heuristicFallbackParse,
};
