from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router

app = FastAPI(
    title="FLAG Research Workbench API",
    version="0.1.0",
    description="Read-only repository discovery and isolated execution adapter for FLAG.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
app.include_router(router)


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "FLAG Research Workbench API", "docs": "/docs", "health": "/api/health"}
