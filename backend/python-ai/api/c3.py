from fastapi import APIRouter
from pydantic import BaseModel, Field

from modules.c3.feedback import generate_feedback

router = APIRouter()


class FeedbackRequest(BaseModel):
    signals: list[str] = Field(default_factory=list)


@router.post("/feedback")
def feedback(request: FeedbackRequest) -> dict[str, object]:
    return generate_feedback(request.signals)
