from fastapi import APIRouter
from pydantic import BaseModel, Field

from modules.c2.questions import score_answer

router = APIRouter()


class ScoreRequest(BaseModel):
    question: str = Field(min_length=1)
    answer: str = Field(min_length=1)


@router.post("/score")
def score_question(request: ScoreRequest) -> dict[str, object]:
    return score_answer(request.question, request.answer)
