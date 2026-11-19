from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.api.rag_routes import rag_router

app = FastAPI(
    title="FLAG Research Workbench API",
    version="0.2.0",
    description="FLAG formal property workbench with RAG-powered timing diagram extraction.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$",
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:5174", "http://127.0.0.1:5174",
        "http://localhost:5175", "http://127.0.0.1:5175",
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:5500", "http://127.0.0.1:5500",
        "http://localhost:8080", "http://127.0.0.1:8080",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)
app.include_router(router)
app.include_router(rag_router)


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "FLAG Research Workbench API", "docs": "/docs", "health": "/api/health"}
