import json
import platform
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse

from app.schemas import (
    ArtifactsResponse,
    CatalogResponse,
    HealthResponse,
    InputFile,
    InputsResponse,
    RunLogsResponse,
    RunRequest,
    RunResponse,
)
from app.services import catalog as catalog_service
from app.services import runs as run_service

router = APIRouter(prefix="/api")


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    entrypoint = catalog_service.REPOSITORY_ROOT / "spec2sva.py"
    return HealthResponse(
        status="ok", service="FLAG research workbench API",
        repository_root=str(catalog_service.REPOSITORY_ROOT),
        python_version=platform.python_version(),
        core_entrypoint_available=entrypoint.is_file(),
    )


@router.get("/catalog", response_model=CatalogResponse)
def get_catalog() -> CatalogResponse:
    return catalog_service.catalog()


@router.get("/inputs", response_model=InputsResponse)
def get_inputs() -> InputsResponse:
    return catalog_service.inputs_response()


@router.get("/inputs/{relative_path:path}")
def get_input_file(relative_path: str):
    item = catalog_service.input_item(relative_path)
    path = catalog_service.validate_discovered_path(relative_path)
    if item.format == "pdf":
        return FileResponse(path, media_type="application/pdf", filename=path.name)
    try:
        return JSONResponse(content=json.loads(path.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=422, detail="Input JSON could not be read.") from exc


@router.post("/runs", response_model=RunResponse, status_code=202)
async def post_run(request: RunRequest) -> RunResponse:
    return await run_service.create_run(request)


@router.get("/runs/{run_id}", response_model=RunResponse)
def get_run(run_id: str) -> RunResponse:
    return run_service.run_response(run_id)


@router.get("/runs/{run_id}/logs", response_model=RunLogsResponse)
def get_run_logs(run_id: str) -> RunLogsResponse:
    return RunLogsResponse(**run_service.read_logs(run_id))


@router.get("/runs/{run_id}/artifacts", response_model=ArtifactsResponse)
def get_artifacts(run_id: str) -> ArtifactsResponse:
    return ArtifactsResponse(run_id=run_id, artifacts=run_service.list_artifacts(run_id))


@router.get("/runs/{run_id}/artifacts/{filename:path}")
def get_artifact(run_id: str, filename: str):
    path = run_service.artifact_path(run_id, filename)
    try:
        content = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=500, detail="Artifact JSON could not be read.") from exc
    return JSONResponse(content=content)
