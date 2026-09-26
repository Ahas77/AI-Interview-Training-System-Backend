from modules.c2.questions import score_answer


def test_score_answer_returns_explanation() -> None:
    result = score_answer("Tell me about yourself", "I build reliable software")
    assert "evidence" in result
