from fastapi import APIRouter
from pydantic import BaseModel, Field

from modules.c1.baseline import build_baseline

router = APIRouter()


class BaselineRequest(BaseModel):
    transcript: str = Field(min_length=1)


@router.post("/analyze")
def analyze_baseline(request: BaselineRequest) -> dict[str, object]:
    return build_baseline(request.transcript)
