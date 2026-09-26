from fastapi import FastAPI
from pydantic import BaseModel, Field

from api.c1 import router as c1_router
from api.c2 import router as c2_router
from api.c3 import router as c3_router

app = FastAPI(title="Interview Coaching AI", version="0.1.0")


class HealthResponse(BaseModel):
    status: str = Field(default="ok")
    service: str = Field(default="python-ai")


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


app.include_router(c1_router, prefix="/api/c1", tags=["baseline analysis"])
app.include_router(c2_router, prefix="/api/c2", tags=["question scoring"])
app.include_router(c3_router, prefix="/api/c3", tags=["coaching signals"])
