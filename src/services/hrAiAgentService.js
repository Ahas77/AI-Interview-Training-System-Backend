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

    const project1 = projects[0]?.title || projects[0]?.name || "";
    const project2 = projects[1]?.title || projects[1]?.name || (projects[0]?.title ? `your work on ${projects[0].title}` : "");
    const pastCompany = workExperiences[0]?.company || "";
    const pastRole = workExperiences[0]?.job_title || "";

    const education = Array.isArray(cvParsedData?.education) ? cvParsedData.education : [];
    const formattedEducation = education
      .map((e) => `${e.degree || "Degree"} at ${e.institution || "University"}`)
      .join(", ");

    const cvContextPrompt = `
=== CANDIDATE UPLOADED CV DATA ===
Candidate Full Name: ${candidateName}
Current Time Greeting: ${timeGreeting}
Target Position Applied For: ${jobRole}
Target Company: ${company || "our enterprise"}
Candidate Experience Level: ${expertiseLevel}

Professional Summary: ${summary || "Engineering background"}
Skills Listed on CV: ${allSkills.join(", ") || "Software development"}
Work History from CV:
${formattedWorkExp || (pastCompany ? `Experience at ${pastCompany}` : "Project-based software experience")}
Projects from CV:
${formattedProjects || (project1 ? `Featured project: ${project1}` : "Portfolio software projects")}
Education from CV: ${formattedEducation || "Relevant degree/training"}
`;

    let questionSpecificRules = "";

    switch (questionNumber) {
      case 1:
        questionSpecificRules = `
OBJECTIVE FOR QUESTION #1: WELCOME & CV-ANCHORED SELF-INTRODUCTION
1. You MUST start by greeting the candidate using the current time of day ("${timeGreeting}") and addressing them by name ("${candidateName}").
2. Ask them to introduce themselves, walk through their professional journey as highlighted in their CV${pastCompany ? ` (such as their experience at ${pastCompany})` : project1 ? ` (such as their work on ${project1})` : ""}, and share what motivates them to join ${company || 'our company'} as a ${jobRole}.
3. Example tone: "${timeGreeting} ${candidateName}, welcome! Could you please introduce yourself, walk us through your professional journey${pastCompany ? ` from ${pastCompany}` : ""}, and share what excites you about the ${jobRole} role at ${company || 'our company'}?"
`;
        break;

      case 2:
        questionSpecificRules = `
OBJECTIVE FOR QUESTION #2: CV PROJECT TEAMWORK & COLLABORATION
1. Do NOT repeat greetings or introductory pleasantries.
2. MANDATORY: Ground your question in a specific project or role from their CV${project1 ? ` (specifically mention '${project1}')` : pastCompany ? ` (mention their time at ${pastCompany})` : ""}.
3. Ask a behavioral question about how they collaborated with team members, designers, or stakeholders during that specific initiative to keep everyone aligned and overcome differing opinions.
4. Example: "In your CV you highlighted '${project1 || "your key project"}'. Could you describe how you collaborated with teammates or stakeholders on that initiative, and how you handled any conflicting perspectives or priorities?"
`;
        break;

      case 3:
        questionSpecificRules = `
OBJECTIVE FOR QUESTION #3: HANDLING PRESSURE & ROADBLOCKS ON CV WORK
1. Do NOT repeat greetings.
2. MANDATORY: Ground your question in their actual work history or projects from their CV${project2 ? ` (cite '${project2}')` : pastRole ? ` (cite their role as ${pastRole})` : ""}.
3. Ask a behavioral STAR question about a major roadblock, critical bug/deadline, or high-pressure situation they faced during that specific project or role, and how they communicated with stakeholders and managed stress to resolve it.
4. Example: "During your work on '${project2 || project1 || "your projects"}', tell me about a time you ran into an unexpected roadblock or aggressive deadline. How did you prioritize your efforts and communicate with your team to deliver?"
`;
        break;

      case 4:
        questionSpecificRules = `
OBJECTIVE FOR QUESTION #4: CONSTRUCTIVE FEEDBACK & CAREER ADAPTABILITY
1. Do NOT repeat greetings.
2. MANDATORY: Connect to their career progression shown in their CV${pastCompany ? ` at ${pastCompany}` : ""}.
3. Ask about a specific time they received critical or constructive feedback from a peer or lead, or had to adapt quickly when project priorities shifted, and how that shaped their professional growth.
4. Example: "Throughout your experience${pastCompany ? ` at ${pastCompany}` : ""}, can you share an instance where you received tough or constructive feedback on your deliverables, and how you adapted your approach as a result?"
`;
        break;

      case 5:
      default:
        questionSpecificRules = `
OBJECTIVE FOR QUESTION #5: CULTURE FIT, VALUES & VISION AT ${company.toUpperCase() || "THE COMPANY"}
1. Do NOT repeat greetings.
2. Connect their CV experience level (${expertiseLevel}) and background to ${company || 'our company'}.
3. Ask what specific workplace environment and team values allow them to do their best work, and what long-term impact or growth they aim to achieve as a ${jobRole} at ${company || 'our organization'}.
4. Example: "Looking at your background and goals, what kind of team culture or leadership style brings out your best work, and how do you envision contributing to and growing with ${company || 'our team'} over the coming years?"
`;
        break;
    }

    const systemPrompt = `You are a warm, professional Senior HR Manager conducting an official real-time HR & Behavioral Interview Round.
${cvContextPrompt}
${questionSpecificRules}

MANDATORY RULES FOR HR INTERVIEW:
1. 100% REAL-TIME DYNAMIC GENERATION: Never return generic or repetitive questions. Tailor the phrasing specifically to this candidate's uploaded CV data.
2. STRICT PROHIBITION ON TECHNICAL QUESTIONS: You are evaluating culture fit, soft skills, communication, teamwork, and emotional intelligence. NEVER ask technical, syntax, coding, architectural, API design, or implementation questions (e.g., do NOT ask about REST API design, algorithms, framework mechanics, or database queries). Technical vetting is strictly reserved for the Technical Round.
3. Keep the question concise, warm, conversational, and direct (1-2 sentences maximum) so it sounds natural when spoken aloud via Text-to-Speech.
4. Do NOT repeat any previous question from this session: ${JSON.stringify(previousQA.map((q) => q.question))}.
5. Return strictly valid JSON format:
{
  "question": "Your question here..."
}`;

    const userPrompt = `Generate Question #${questionNumber} for ${candidateName} in real time:`;

    try {
      const rawAiResponse = await AIProvider.generateJSON(systemPrompt, userPrompt);
      if (rawAiResponse) {
        if (typeof rawAiResponse === "object" && rawAiResponse !== null) {
          if (rawAiResponse.question && typeof rawAiResponse.question === "string") {
            return rawAiResponse.question.trim();
          }
          if (typeof rawAiResponse.text === "string" && rawAiResponse.text.trim()) {
            return rawAiResponse.text.trim();
          }
        } else if (typeof rawAiResponse === "string") {
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
      }
    } catch (err) {
      console.error("HRAiAgentService Error:", err.message);
    }

    // Emergency LLM call if first attempt failed
    const fallbackQuestion = await AIProvider.callFreeLLM(systemPrompt, userPrompt);
    if (fallbackQuestion) {
      if (typeof fallbackQuestion === "object" && fallbackQuestion !== null) {
        if (fallbackQuestion.question && typeof fallbackQuestion.question === "string") {
          return fallbackQuestion.question.trim();
        }
      } else if (typeof fallbackQuestion === "string") {
        try {
          const cleaned = fallbackQuestion.replace(/```json/g, "").replace(/```/g, "").trim();
          const parsed = JSON.parse(cleaned);
          if (parsed && parsed.question) return parsed.question.trim();
        } catch (e) {
          if (fallbackQuestion.length > 10) return fallbackQuestion.trim();
        }
      }
    }

    // Default dynamic Question 1 if LLM completely offline
    if (questionNumber === 1) {
      return `${timeGreeting} ${candidateName}, welcome! Could you please introduce yourself and walk us through your professional background and interest in the ${jobRole} role at ${company || 'our company'}?`;
    }

    return `Could you share a time from your past experience when you had to collaborate closely with a team or stakeholder to successfully navigate a challenging project?`;
  },
};

module.exports = HRAiAgentService;
