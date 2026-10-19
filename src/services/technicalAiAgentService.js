const AIProvider = require("./ai/aiProvider");

/**
 * Technical AI Agent Service
 * Generates 10 structured, unscripted, highly targeted technical interview questions grounded in candidate CV + real company requirements.
 */
class TechnicalAiAgentService {
  /**
   * Generates the next technical interview question (1 to 10)
   */
  static async generateTechnicalQuestion({
    cvRawText = "",
    cvParsedData = null,
    jobRole = "Software Engineer",
    company = "Tech Company",
    expertiseLevel = "Intermediate",
    companyRequirements = [],
    previousQA = [],
    questionNumber = 1,
    userName = "",
  }) {
    // 1. Candidate Name resolution
    const candidateName =
      userName ||
      cvParsedData?.candidate?.full_name ||
      cvParsedData?.candidate_name ||
      "Candidate";

    // 2. Extract CV Skills
    const techSkills = Array.isArray(cvParsedData?.technical_skills) ? cvParsedData.technical_skills : [];
    const mainSkills = Array.isArray(cvParsedData?.skills) ? cvParsedData.skills : [];
    const tools = Array.isArray(cvParsedData?.tools_and_frameworks) ? cvParsedData.tools_and_frameworks : [];
    const dbs = Array.isArray(cvParsedData?.databases_and_cloud) ? cvParsedData.databases_and_cloud : [];
    const allSkills = [...new Set([...techSkills, ...mainSkills, ...tools, ...dbs])].filter(Boolean);

    // 3. Extract CV Projects
    const projects = Array.isArray(cvParsedData?.projects) ? cvParsedData.projects : [];
    const formattedProjects = projects
      .map(
        (p, idx) =>
          `Project #${idx + 1}: '${p.title || "Project"}' - ${p.description || "Description"} (Technologies: ${
            Array.isArray(p.technologies) ? p.technologies.join(", ") : "N/A"
          })`
      )
      .join("\n");

    // 4. Format Verified Company Requirements
    const formattedRequirements = Array.isArray(companyRequirements) && companyRequirements.length > 0
      ? companyRequirements
          .map(
            (r, idx) =>
              `- Req #${idx + 1} [${r.requirement_category || r.category}]: ${r.requirement_name || r.name} (${
                r.requirement_type || r.type || "required"
              }) - Excerpt: "${r.evidence_excerpt || r.description || "N/A"}"`
          )
          .join("\n")
      : "No verified company-specific job requirements available. Base questions on industry standard requirements for the role.";

    // 5. Structure question objective for each of the 10 questions
    const questionObjective = this.getQuestionObjective(questionNumber, allSkills, projects, company);

    const systemPrompt = `You are a Principal Technical Interviewer conducting a formal technical interview for the role of ${jobRole} at ${company} (Target Level: ${expertiseLevel}).

CRITICAL INSTRUCTIONS:
1. Generate Question #${questionNumber} of 10.
2. The question must be 100% focused on the objective defined below.
3. Reference real details from the candidate's CV (their actual skills: ${allSkills.slice(0, 15).join(", ")} and their actual projects) whenever applicable.
4. If company requirements are available, weave them organically into the question.
5. Calibrate question complexity strictly to their level (${expertiseLevel}):
   - Beginner: Core mechanics, clean syntax, error handling, practical usage.
   - Intermediate: Internal workings, edge cases, trade-offs, concurrency, optimization.
   - Senior/Lead: Architectural resilience, failure modes, scale, distributed consistency, system trade-offs.
6. Return valid JSON containing:
   - "question_number": ${questionNumber}
   - "question_category": Short category title
   - "question": "The complete, clear technical question text"
   - "context_hint": "Brief 1-sentence hint or context for the candidate"
   - "code_snippet": Optional code snippet (or null if conceptual/verbal)`;

    const userPrompt = `
=== CANDIDATE PROFILE ===
Candidate Name: ${candidateName}
Role: ${jobRole}
Target Company: ${company}
Seniority Level: ${expertiseLevel}

Candidate Skills: ${allSkills.join(", ") || "General Engineering"}
Candidate Projects:
${formattedProjects || "Engineering Projects from CV"}

=== VERIFIED TARGET COMPANY REQUIREMENTS ===
${formattedRequirements}

=== QUESTION #${questionNumber} OBJECTIVE ===
${questionObjective}

=== PREVIOUS QUESTIONS IN THIS SESSION (DO NOT REPEAT TOPICS) ===
${JSON.stringify(previousQA.map((q) => q.question))}
`;

    const response = await AIProvider.generateJSON(systemPrompt, userPrompt);
    return response;
  }

  /**
   * Defines the 10-Question Structured Flow
   */
  static getQuestionObjective(questionNumber, skills, projects, company) {
    const primarySkill = skills[0] || "core programming language";
    const project1 = projects[0]?.title || "your primary project";
    const project2 = projects[1]?.title || projects[0]?.title || "your recent project";

    switch (questionNumber) {
      case 1:
        return `[Core Language & Runtime Mechanics]: Ask a deep conceptual question about the candidate's primary language (${primarySkill}), focusing on runtime execution, memory model, garbage collection/pointers, or event loop mechanics.`;

      case 2:
        return `[Data Structures & Algorithm Efficiency]: Ask how to choose and optimize an appropriate data structure (e.g., Hash Table, B-Tree, Queue, Trie) for a real-world scenario matching the ${skills[1] || "core stack"}, including time/space complexity trade-offs.`;

      case 3:
        return `[Deep Dive: CV Project #1]: Specifically cite the candidate's project '${project1}'. Ask about its internal architectural design, component communication, state/data flow, or technical trade-offs made during its development.`;

      case 4:
        return `[CV Project Implementation & Problem Solving]: Specifically cite project '${project2}'. Ask about a difficult technical challenge, performance bottleneck, or edge case they solved in this project, and how they tested/validated the solution.`;

      case 5:
        return `[Target Company Tech Stack Deep-Dive]: Focus directly on the verified technical requirements for ${company}. Ask a specific question about the tools, frameworks, or cloud patterns expected at ${company} (e.g., microservices, API protocols, containerization).`;

      case 6:
        return `[Company Engineering Production Scenario]: Present a realistic production incident or high-load scenario relevant to ${company}'s domain. Ask how they would diagnose, triage, and implement a resilient technical solution.`;

      case 7:
        return `[Database Design, Indexing & Query Optimization]: Ask about database schema design, indexing strategies, transaction isolation levels (ACID), or query optimization techniques for relational or NoSQL stores.`;

      case 8:
        return `[Concurrency, Asynchrony & Thread Safety]: Ask about managing concurrency, multithreading, async/await, race conditions, deadlocks, or distributed locking.`;

      case 9:
        return `[API Security, Governance & Resiliency]: Ask about API security best practices (OAuth2, JWT validation, OWASP top 10), rate limiting, circuit breaker patterns, or defense against injection/replay attacks.`;

      case 10:
        return `[System Design & Scalability Challenge]: Present an architectural design challenge appropriate for their level (Senior: distributed microservices, caching, event streaming; Beginner: robust endpoint service with logging and failover).`;

      default:
        return `[Technical Competence]: Ask a practical problem-solving question based on their engineering stack.`;
    }
  }
}

module.exports = TechnicalAiAgentService;
