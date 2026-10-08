require("dotenv").config();
const HRAiAgentService = require("./src/services/hrAiAgentService");

async function testTimeAndNameGreeting() {
  console.log("Testing Question #1 (Time greeting + Name + Introduction)...");

  const mockCVData = {
    candidate: { full_name: "Dhanith Sri" },
    professional_summary: "Full Stack Developer",
  };

  const q1 = await HRAiAgentService.generateNextQuestion({
    cvParsedData: mockCVData,
    jobRole: "Software Engineer",
    company: "WSO2",
    expertiseLevel: "Intermediate",
    questionNumber: 1,
    userName: "Dhanith Sri",
  });

  console.log("\n🤖 REAL-TIME QUESTION #1 (TIME GREETING + INTRO):\n", q1);
}

testTimeAndNameGreeting();
