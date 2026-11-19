"""
rag_db.py — SQLite persistence layer for the FLAG RAG pipeline.

Tables:
  spec_documents  — uploaded protocol PDF files (metadata + storage path)
  extracted_diagrams — timing diagrams produced by the RAG extractor, keyed to a document
  extraction_jobs — async job tracking for in-progress extractions
"""

import json
import logging
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# DB lives next to the backend data directory
_DB_ROOT = Path(__file__).resolve().parents[2] / "data" / "rag"
_DB_ROOT.mkdir(parents=True, exist_ok=True)
DB_PATH = _DB_ROOT / "rag.db"

# Uploaded PDFs are stored here (original files, never modified)
SPECS_STORE = _DB_ROOT / "specs"
SPECS_STORE.mkdir(parents=True, exist_ok=True)

# Cropped figure images are cached here
FIGURES_STORE = _DB_ROOT / "figures"
FIGURES_STORE.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Schema creation
# ---------------------------------------------------------------------------

_SCHEMA = """
CREATE TABLE IF NOT EXISTS spec_documents (
    id          TEXT PRIMARY KEY,
    filename    TEXT NOT NULL,
    protocol    TEXT NOT NULL,
    description TEXT,
    file_path   TEXT NOT NULL,
    file_size   INTEGER NOT NULL,
    page_count  INTEGER,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS extracted_diagrams (
    id              TEXT PRIMARY KEY,
    doc_id          TEXT NOT NULL REFERENCES spec_documents(id) ON DELETE CASCADE,
    mechanism       TEXT NOT NULL,
    figure_number   TEXT,
    caption         TEXT,
    page_number     INTEGER,
    figure_image_path TEXT,
    timing_json     TEXT NOT NULL,
    wavedrom_json   TEXT,
    signal_names    TEXT,
    created_at      TEXT NOT NULL,
    UNIQUE(doc_id, figure_number)
);

CREATE TABLE IF NOT EXISTS extraction_jobs (
    id          TEXT PRIMARY KEY,
    doc_id      TEXT NOT NULL REFERENCES spec_documents(id) ON DELETE CASCADE,
    mechanism   TEXT NOT NULL,
    model       TEXT NOT NULL DEFAULT 'gpt-4o',
    status      TEXT NOT NULL DEFAULT 'queued',
    progress    INTEGER DEFAULT 0,
    total       INTEGER DEFAULT 0,
    error       TEXT,
    created_at  TEXT NOT NULL,
    finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_diagrams_doc ON extracted_diagrams(doc_id);
CREATE INDEX IF NOT EXISTS idx_jobs_doc     ON extraction_jobs(doc_id);
"""


def _connect() -> sqlite3.Connection:
    con = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con


def init_db() -> None:
    """Create tables (idempotent — safe to call on every startup)."""
    with _connect() as con:
        con.executescript(_SCHEMA)
    logger.info("RAG database initialized at %s", DB_PATH)


# ---------------------------------------------------------------------------
# spec_documents helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def insert_document(
    *,
    filename: str,
    protocol: str,
    description: str | None,
    file_path: str,
    file_size: int,
    page_count: int | None = None,
) -> dict[str, Any]:
    doc_id = uuid.uuid4().hex
    created = _now_iso()
    with _connect() as con:
        con.execute(
            """INSERT INTO spec_documents
               (id, filename, protocol, description, file_path, file_size, page_count, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (doc_id, filename, protocol, description, file_path, file_size, page_count, created),
        )
    return {
        "id": doc_id, "filename": filename, "protocol": protocol,
        "description": description, "file_path": file_path,
        "file_size": file_size, "page_count": page_count, "created_at": created,
    }


def list_documents() -> list[dict[str, Any]]:
    with _connect() as con:
        rows = con.execute(
            "SELECT * FROM spec_documents ORDER BY created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def get_document(doc_id: str) -> dict[str, Any] | None:
    with _connect() as con:
        row = con.execute(
            "SELECT * FROM spec_documents WHERE id = ?", (doc_id,)
        ).fetchone()
    return dict(row) if row else None


def delete_document(doc_id: str) -> bool:
    """Delete document record (cascades to diagrams + jobs). Also removes the PDF file."""
    doc = get_document(doc_id)
    if not doc:
        return False
    with _connect() as con:
        con.execute("DELETE FROM spec_documents WHERE id = ?", (doc_id,))
    # Clean up stored file
    try:
        Path(doc["file_path"]).unlink(missing_ok=True)
    except Exception:
        pass
    return True


def update_document_page_count(doc_id: str, page_count: int) -> None:
    with _connect() as con:
        con.execute(
            "UPDATE spec_documents SET page_count = ? WHERE id = ?",
            (page_count, doc_id),
        )


# ---------------------------------------------------------------------------
# extracted_diagrams helpers
# ---------------------------------------------------------------------------

def insert_diagram(
    *,
    doc_id: str,
    mechanism: str,
    figure_number: str | None,
    caption: str | None,
    page_number: int | None,
    figure_image_path: str | None,
    timing_json: dict,
    wavedrom_json: dict | None = None,
) -> dict[str, Any]:
    diag_id = uuid.uuid4().hex
    created = _now_iso()
    signal_names = json.dumps([s["name"] for s in timing_json.get("signals", [])])
    with _connect() as con:
        con.execute(
            """INSERT OR REPLACE INTO extracted_diagrams
               (id, doc_id, mechanism, figure_number, caption, page_number,
                figure_image_path, timing_json, wavedrom_json, signal_names, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                diag_id, doc_id, mechanism, figure_number, caption, page_number,
                figure_image_path,
                json.dumps(timing_json),
                json.dumps(wavedrom_json) if wavedrom_json else None,
                signal_names, created,
            ),
        )
    return {
        "id": diag_id, "doc_id": doc_id, "mechanism": mechanism,
        "figure_number": figure_number, "caption": caption,
        "page_number": page_number, "figure_image_path": figure_image_path,
        "timing_json": timing_json, "wavedrom_json": wavedrom_json,
        "signal_names": signal_names, "created_at": created,
    }


def list_diagrams(doc_id: str) -> list[dict[str, Any]]:
    with _connect() as con:
        rows = con.execute(
            "SELECT * FROM extracted_diagrams WHERE doc_id = ? ORDER BY page_number ASC NULLS LAST, created_at ASC",
            (doc_id,),
        ).fetchall()
    results = []
    for r in rows:
        d = dict(r)
        d["timing_json"] = json.loads(d["timing_json"])
        d["wavedrom_json"] = json.loads(d["wavedrom_json"]) if d.get("wavedrom_json") else None
        d["signal_names"] = json.loads(d["signal_names"]) if d.get("signal_names") else []
        results.append(d)
    return results


def get_diagram(diag_id: str) -> dict[str, Any] | None:
    with _connect() as con:
        row = con.execute(
            "SELECT * FROM extracted_diagrams WHERE id = ?", (diag_id,)
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    d["timing_json"] = json.loads(d["timing_json"])
    d["wavedrom_json"] = json.loads(d["wavedrom_json"]) if d.get("wavedrom_json") else None
    d["signal_names"] = json.loads(d["signal_names"]) if d.get("signal_names") else []
    return d


def delete_diagram(diag_id: str) -> bool:
    with _connect() as con:
        cur = con.execute("DELETE FROM extracted_diagrams WHERE id = ?", (diag_id,))
    return cur.rowcount > 0


# ---------------------------------------------------------------------------
# extraction_jobs helpers
# ---------------------------------------------------------------------------

def create_job(*, doc_id: str, mechanism: str, model: str = "gpt-4o") -> dict[str, Any]:
    job_id = uuid.uuid4().hex
    created = _now_iso()
    with _connect() as con:
        con.execute(
            """INSERT INTO extraction_jobs
               (id, doc_id, mechanism, model, status, progress, total, created_at)
               VALUES (?, ?, ?, ?, 'queued', 0, 0, ?)""",
            (job_id, doc_id, mechanism, model, created),
        )
    return {"id": job_id, "doc_id": doc_id, "mechanism": mechanism,
            "model": model, "status": "queued", "progress": 0, "total": 0,
            "error": None, "created_at": created, "finished_at": None}


def get_job(job_id: str) -> dict[str, Any] | None:
    with _connect() as con:
        row = con.execute(
            "SELECT * FROM extraction_jobs WHERE id = ?", (job_id,)
        ).fetchone()
    return dict(row) if row else None


def list_jobs(doc_id: str | None = None) -> list[dict[str, Any]]:
    with _connect() as con:
        if doc_id:
            rows = con.execute(
                "SELECT * FROM extraction_jobs WHERE doc_id = ? ORDER BY created_at DESC",
                (doc_id,),
            ).fetchall()
        else:
            rows = con.execute(
                "SELECT * FROM extraction_jobs ORDER BY created_at DESC"
            ).fetchall()
    return [dict(r) for r in rows]


def update_job(job_id: str, **fields) -> None:
    if not fields:
        return
    cols = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [job_id]
    with _connect() as con:
        con.execute(f"UPDATE extraction_jobs SET {cols} WHERE id = ?", vals)


# ---------------------------------------------------------------------------
# Init on import
# ---------------------------------------------------------------------------
init_db()
