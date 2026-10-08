const AIProvider = require("./ai/aiProvider");

const HRAiAgentService = {
  /**
   * Generates a 100% real-time, original AI HR Question based on candidate CV data
   * Question #1: Time-of-day Greeting + Candidate Name + Self-Introduction question
   * Question #2..#5: Deep CV-based HR questions tailored to projects, skills, past company experiences, & challenges
   */
  async generateNextQuestion({
    cvRawText = "",
    cvParsedData = null,
    jobRole = "Software Engineer",
    company = "Tech Company",
    expertiseLevel = "Intermediate",
    previousQA = [],
    questionNumber = 1,
    userName = "",
  }) {
    // 1. Determine current time of day dynamically
    const hour = new Date().getHours();
    let timeGreeting = "Good morning";
    if (hour >= 12 && hour < 17) {
      timeGreeting = "Good afternoon";
    } else if (hour >= 17 || hour < 5) {
      timeGreeting = "Good evening";
    }

    // 2. Candidate Name priority: userName > cvParsedData.candidate.full_name > "Candidate"
    const candidateName =
      userName ||
      cvParsedData?.candidate?.full_name ||
      cvParsedData?.candidate_name ||
      "Candidate";

    const summary = cvParsedData?.professional_summary || "";

    const techSkills = Array.isArray(cvParsedData?.technical_skills) ? cvParsedData.technical_skills : [];
    const mainSkills = Array.isArray(cvParsedData?.skills) ? cvParsedData.skills : [];
    const tools = Array.isArray(cvParsedData?.tools_and_frameworks) ? cvParsedData.tools_and_frameworks : [];
    const dbs = Array.isArray(cvParsedData?.databases_and_cloud) ? cvParsedData.databases_and_cloud : [];
    const allSkills = [...new Set([...techSkills, ...mainSkills, ...tools, ...dbs])].filter(Boolean);

    const workExperiences = Array.isArray(cvParsedData?.work_experience) ? cvParsedData.work_experience : [];
    const formattedWorkExp = workExperiences
      .map(
        (w, idx) =>
          `Position #${idx + 1}: ${w.job_title || "Engineer"} at ${w.company || "Company"}. Responsibilities: ${
            Array.isArray(w.responsibilities) ? w.responsibilities.join("; ") : "N/A"
          }`
      )
      .join("\n");

    const projects = Array.isArray(cvParsedData?.projects) ? cvParsedData.projects : [];
    const formattedProjects = projects
      .map(
        (p, idx) =>
          `Project #${idx + 1}: '${p.title || "Project"}' - ${p.description || ""} (Tech Stack: ${
            Array.isArray(p.technologies) ? p.technologies.join(", ") : "N/A"
          })`
      )
      .join("\n");

    const education = Array.isArray(cvParsedData?.education) ? cvParsedData.education : [];
    const formattedEducation = education
      .map((e) => `${e.degree || "Degree"} at ${e.institution || "University"}`)
      .join(", ");

    const cvContextPrompt = `
=== CANDIDATE REAL CV DATA ===
Candidate Full Name: ${candidateName}
Current Time Greeting: ${timeGreeting}
Target Position: ${jobRole}
Target Company: ${company || "our enterprise"}
Expertise Seniority: ${expertiseLevel}

Professional Summary: ${summary}
Skills & Tech Stack: ${allSkills.join(", ")}
Work History:
${formattedWorkExp || "Software engineering background"}
Projects:
${formattedProjects || "Key software projects"}
Education: ${formattedEducation}
Raw CV Text Snippet: ${cvRawText ? cvRawText.slice(0, 2000) : "N/A"}
`;

    let questionSpecificRules = "";

    if (questionNumber === 1) {
      questionSpecificRules = `
SPECIAL RULE FOR QUESTION #1 (INTRODUCTORY QUESTION):
1. You MUST start the question by greeting the candidate using the current time of day ("${timeGreeting}") and addressing them directly by their full name ("${candidateName}").
2. Ask them to introduce themselves ("yourself"), share an overview of their professional background, and explain what interests them about the ${jobRole} role at ${company || 'our company'}.
3. Example tone: "${timeGreeting} ${candidateName}, welcome! Could you please introduce yourself and share a brief overview of your background and interest in the ${jobRole} position?"
`;
    } else {
      questionSpecificRules = `
SPECIAL RULE FOR QUESTION #${questionNumber} (DEEP CV HR QUESTION):
1. Do NOT repeat any greeting or introduction.
2. Ask a deep, specific HR question based on their actual CV data above (reference their specific project titles, specific past company experiences, specific technical skills like ${allSkills.slice(0, 50)}, or team challenges).
3. Do NOT repeat any previous question from history: ${JSON.stringify(previousQA.map((q) => q.question))}.
`;
    }

    const systemPrompt = `You are a live, spontaneous Senior HR Manager conducting a real-time HR interview round.
${cvContextPrompt}
${questionSpecificRules}

GENERAL RULES:
1. Keep the question concise, warm, and clear (1-2 sentences maximum) so it sounds natural when spoken aloud via Text-to-Speech.
2. Return strictly valid JSON format:
{
  "question": "Your question here..."
}`;

    const userPrompt = `Generate Question #${questionNumber} for ${candidateName} in real time:`;

    try {
      const rawAiResponse = await AIProvider.generateJSON(systemPrompt, userPrompt);
      if (rawAiResponse) {
        let cleaned = rawAiResponse.replace(/```json/g, "").replace(/```/g, "").trim();
        try {
          const parsed = JSON.parse(cleaned);
          if (parsed && parsed.question && typeof parsed.question === "string") {
            return parsed.question.trim();
          }
        } catch (jsonErr) {
          if (cleaned.length > 10) {
            return cleaned.replace(/^["']|["']$/g, "").trim();
          }
        }
      }
    } catch (err) {
      console.error("HRAiAgentService Error:", err.message);
    }

    // Emergency LLM call if first attempt failed
    const fallbackQuestion = await AIProvider.callFreeLLM(systemPrompt, userPrompt);
    if (fallbackQuestion) {
      try {
        const cleaned = fallbackQuestion.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleaned);
        if (parsed && parsed.question) return parsed.question.trim();
      } catch (e) {
        if (fallbackQuestion.length > 10) return fallbackQuestion.trim();
      }
    }

    // Default dynamic Question 1 if LLM completely offline
    if (questionNumber === 1) {
      return `${timeGreeting} ${candidateName}, welcome! Could you please introduce yourself and walk us through your professional background and interest in the ${jobRole} role at ${company || 'our company'}?`;
    }

    return `Could you share a specific technical project or accomplishment from your experience that best demonstrates your problem-solving skills as a ${jobRole}?`;
  },
};

module.exports = HRAiAgentService;
