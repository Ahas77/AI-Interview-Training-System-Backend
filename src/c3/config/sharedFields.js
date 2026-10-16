// Only these columns may be SELECTed from teammates' tables. Add aliases here if renamed.
module.exports = {
  interview_sessions: { id: ["id"], user_id: ["user_id", "userId"], status: ["status"],
    created_at: ["created_at"], completed_at: ["completed_at"], job_role: ["job_role"],
    target_company: ["target_company"], expertise_level: ["expertise_level"], session_type: ["session_type"] },
  interview_qa_logs: { id: ["id"], session_id: ["session_id", "sessionId"],
    question_number: ["question_number"], question_text: ["question_text"],
    user_answer_text: ["user_answer_text", "answer_text"], created_at: ["created_at"],
    question_type: ["question_type"], answer_score: ["answer_score"], answered_at: ["answered_at"] },
  users: { id: ["id"], email: ["email"], role: ["role"] },
};
