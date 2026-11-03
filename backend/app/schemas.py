from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    repository_root: str
    python_version: str
    core_entrypoint_available: bool


class InputFile(BaseModel):
    path: str
    kind: Literal["grammar", "timing_diagram", "specification"]
    format: str
    protocol: str | None = None
    mechanism: str | None = None


class TestCase(BaseModel):
    protocol: str
    mechanism: str
    timing_diagram_files: list[str]
    specification_files: list[str]


class CatalogCounts(BaseModel):
    protocols: int
    test_cases: int
    grammars: int
    timing_diagrams: int
    specifications: int


class CatalogResponse(BaseModel):
    protocol_families: list[str]
    test_cases: list[TestCase]
    grammar_files: list[InputFile]
    timing_diagram_files: list[InputFile]
    specification_files: list[InputFile]
    counts: CatalogCounts


class InputsResponse(BaseModel):
    inputs: list[InputFile]


class RunRequest(BaseModel):
    grammar_path: str = Field(min_length=1)
    timing_diagram_path: str | None = None
    mode: Literal["all", "g2t", "t2p"] = "all"
    verbose: bool = True


class RunResponse(BaseModel):
    run_id: str
    status: Literal["queued", "running", "completed", "failed"]
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    exit_code: int | None = None
    mode: Literal["all", "g2t", "t2p"]
    grammar_path: str
    timing_diagram_path: str | None = None
    verbose: bool
    error: str | None = None


class RunLogsResponse(BaseModel):
    run_id: str
    status: Literal["queued", "running", "completed", "failed"]
    stdout: str
    stderr: str
    combined: str


class ArtifactInfo(BaseModel):
    filename: str
    path: str
    size_bytes: int
    format: str


class ArtifactsResponse(BaseModel):
    run_id: str
    artifacts: list[ArtifactInfo]
