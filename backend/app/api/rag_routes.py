"""
RAG extraction API routes — added to the FLAG backend.

Endpoints:
  POST /api/rag/documents                     Upload a protocol PDF
  GET  /api/rag/documents                     List all uploaded documents
  GET  /api/rag/documents/{doc_id}            Get document metadata
  DELETE /api/rag/documents/{doc_id}          Delete document + its diagrams
  GET  /api/rag/documents/{doc_id}/diagrams   List all extracted diagrams for a doc
  GET  /api/rag/diagrams/{diag_id}            Get one extracted diagram (full JSON)
  DELETE /api/rag/diagrams/{diag_id}          Delete one extracted diagram
  GET  /api/rag/diagrams/{diag_id}/figure     Get the cropped figure PNG image
  POST /api/rag/extract                       Start async extraction job
  GET  /api/rag/jobs/{job_id}                 Poll extraction job status
  GET  /api/rag/jobs                          List all jobs
  POST /api/rag/diagrams/{diag_id}/promote    Copy diagram into test_cases/ for use in FLAG runs
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from app.services import rag_db as db
from app.services.rag_db import FIGURES_STORE, SPECS_STORE
from app.services.catalog import REPOSITORY_ROOT

logger = logging.getLogger(__name__)
rag_router = APIRouter(prefix="/api/rag", tags=["rag"])

# Maximum upload size: 50 MB
MAX_UPLOAD_BYTES = 50 * 1024 * 1024

# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

@rag_router.post("/documents")
async def upload_document(
    file: UploadFile = File(...),
    protocol: str = Form(...),
    description: str = Form(""),
):
    """Upload a protocol PDF and persist it to the RAG document store."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {MAX_UPLOAD_BYTES // (1024*1024)} MB limit.",
        )

    # Persist to disk
    safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in (file.filename or "spec.pdf"))
    dest = SPECS_STORE / safe_name
    # Avoid collisions
    counter = 1
    while dest.exists():
        dest = SPECS_STORE / f"{dest.stem}_{counter}{dest.suffix}"
        counter += 1
    dest.write_bytes(contents)

    # Count pages (best-effort — requires PyMuPDF)
    page_count: int | None = None
    try:
        import fitz
        with fitz.open(str(dest)) as doc_tmp:
            page_count = len(doc_tmp)
    except Exception:
        pass

    record = db.insert_document(
        filename=file.filename,
        protocol=protocol.strip(),
        description=description.strip() or None,
        file_path=str(dest),
        file_size=len(contents),
        page_count=page_count,
    )
    return JSONResponse(content=record, status_code=201)


@rag_router.get("/documents")
def list_documents():
    return JSONResponse(content=db.list_documents())


@rag_router.get("/documents/{doc_id}")
def get_document(doc_id: str):
    doc = db.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    return JSONResponse(content=doc)


@rag_router.delete("/documents/{doc_id}")
def delete_document(doc_id: str):
    if not db.delete_document(doc_id):
        raise HTTPException(status_code=404, detail="Document not found.")
    return JSONResponse(content={"deleted": doc_id})


@rag_router.get("/documents/{doc_id}/diagrams")
def list_diagrams(doc_id: str):
    if not db.get_document(doc_id):
        raise HTTPException(status_code=404, detail="Document not found.")
    return JSONResponse(content=db.list_diagrams(doc_id))


# ---------------------------------------------------------------------------
# Diagrams
# ---------------------------------------------------------------------------

@rag_router.get("/diagrams/{diag_id}")
def get_diagram(diag_id: str):
    d = db.get_diagram(diag_id)
    if not d:
        raise HTTPException(status_code=404, detail="Diagram not found.")
    return JSONResponse(content=d)


@rag_router.delete("/diagrams/{diag_id}")
def delete_diagram(diag_id: str):
    if not db.delete_diagram(diag_id):
        raise HTTPException(status_code=404, detail="Diagram not found.")
    return JSONResponse(content={"deleted": diag_id})


@rag_router.get("/diagrams/{diag_id}/figure")
def get_figure_image(diag_id: str):
    """Return the cropped page PNG for a diagram (if it was saved)."""
    d = db.get_diagram(diag_id)
    if not d:
        raise HTTPException(status_code=404, detail="Diagram not found.")
    img_path = d.get("figure_image_path")
    if not img_path or not Path(img_path).is_file():
        raise HTTPException(status_code=404, detail="Figure image not available.")
    return FileResponse(img_path, media_type="image/png")


@rag_router.post("/diagrams/{diag_id}/promote")
def promote_diagram(
    diag_id: str,
    protocol: str = Form(...),
    mechanism: str = Form(...),
):
    """
    Copy the extracted timing_diagrams.json and timing_diagrams_wavedrom.json 
    into test_cases/<protocol>/<mechanism>/ so FLAG can use them in a run.
    """
    d = db.get_diagram(diag_id)
    if not d:
        raise HTTPException(status_code=404, detail="Diagram not found.")

    target_dir = REPOSITORY_ROOT / "test_cases" / protocol / mechanism
    target_dir.mkdir(parents=True, exist_ok=True)

    # Write self-defined JSON
    td_path = target_dir / "timing_diagrams.json"
    td_path.write_text(
        __import__("json").dumps(d["timing_json"], indent=2), encoding="utf-8"
    )

    # Write WaveDrom JSON (if available)
    wd_path: Path | None = None
    if d.get("wavedrom_json"):
        wd_path = target_dir / "timing_diagrams_wavedrom.json"
        wd_path.write_text(
            __import__("json").dumps(d["wavedrom_json"], indent=2), encoding="utf-8"
        )

    return JSONResponse(content={
        "promoted_to": str(target_dir),
        "timing_diagrams_json": str(td_path),
        "wavedrom_json": str(wd_path) if wd_path else None,
    })


# ---------------------------------------------------------------------------
# API Key Verification (OpenRouter & OpenAI)
# ---------------------------------------------------------------------------

@rag_router.post("/test-key")
async def test_api_key(
    openai_api_key: str = Form(...),
    model: str = Form("gpt-4o"),
):
    """Test API key authentication, quota, and connectivity for OpenAI or OpenRouter."""
    key = openai_api_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="API key is empty.")

    is_openrouter = key.startswith("sk-or-")

    # Path A: OpenRouter Verification
    if is_openrouter:
        import urllib.request
        import json as _json

        req = urllib.request.Request(
            "https://openrouter.ai/api/v1/auth/key",
            headers={
                "Authorization": f"Bearer {key}",
                "HTTP-Referer": "http://localhost:5175",
                "X-Title": "FLAG Formal SVA Studio",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=12) as resp:
                data = _json.loads(resp.read().decode())
                key_info = data.get("data", {})
                usage = key_info.get("usage", 0)
                limit = key_info.get("limit")
                label = key_info.get("label") or "Active Key"
                limit_str = f"${limit:.2f}" if limit is not None else "no limit"
                return JSONResponse(content={
                    "status": "ok",
                    "provider": "openrouter",
                    "message": f"Verified OpenRouter Key! Label: '{label}' | Credits Used: ${usage:.4f} (Limit: {limit_str}). Ready to extract!",
                    "model_confirmed": True,
                })
        except Exception as exc:
            err = str(exc)
            if hasattr(exc, "read"):
                try:
                    err_json = _json.loads(exc.read().decode())
                    err = err_json.get("error", {}).get("message", err)
                except Exception:
                    pass
            raise HTTPException(status_code=400, detail=f"OpenRouter Error: {err}")

    # Path B: Standard OpenAI Verification
    try:
        from app.services.pdf_extractor import _openai_client
        client = _openai_client(key)
        models = client.models.list()
        avail = [m.id for m in models.data]
        has_model = any(model in m for m in avail)
        return JSONResponse(content={
            "status": "ok",
            "provider": "openai",
            "message": f"Successfully authenticated with OpenAI! Model '{model}' is accessible.",
            "available_models_count": len(avail),
            "model_confirmed": has_model,
        })
    except Exception as exc:
        err = str(exc)
        if "insufficient_quota" in err or "429" in err or "quota" in err.lower():
            detail = (
                "OpenAI Quota Exceeded (429): Your OpenAI account has $0.00 credits or billing is inactive. "
                "OpenAI requires paid API credits. Check https://platform.openai.com/billing. "
                "Tip: You can use your OpenRouter key (starts with 'sk-or-') which has tokens available!"
            )
        elif "invalid_api_key" in err or "401" in err or "Incorrect API key" in err:
            detail = "Invalid API Key (401): The key was rejected by OpenAI. If using OpenRouter, make sure your key starts with 'sk-or-v1-'."
        elif "Connection error" in err or "getaddrinfo" in err:
            detail = "Network Connection Error: Could not reach API endpoint. Check internet connection / proxy."
        else:
            detail = f"API Error: {err}"
        raise HTTPException(status_code=400, detail=detail)


# ---------------------------------------------------------------------------
# Extraction jobs
# ---------------------------------------------------------------------------

@rag_router.post("/extract")
async def start_extraction(
    background_tasks: BackgroundTasks,
    doc_id: str = Form(...),
    mechanism: str = Form(""),
    model: str = Form("rule_based"),
    openai_api_key: str = Form(""),
):
    """Start an async extraction job for a document."""
    doc = db.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    if not Path(doc["file_path"]).is_file():
        raise HTTPException(
            status_code=422, detail="Stored PDF file is missing on disk."
        )

    api_key = openai_api_key.strip() or os.environ.get("OPENAI_API_KEY", "")
    if model != "rule_based" and not api_key:
        raise HTTPException(
            status_code=422,
            detail="An OpenAI API key is required when using an OpenAI VLM model. Or select 'Rule-Based Extractor (Offline / 0 Tokens)'.",
        )

    job = db.create_job(doc_id=doc_id, mechanism=mechanism.strip(), model=model)
    background_tasks.add_task(
        _run_extraction_job, job["id"], doc, mechanism.strip(), api_key, model
    )
    return JSONResponse(content=job, status_code=202)


@rag_router.get("/jobs")
def list_jobs(doc_id: str | None = None):
    return JSONResponse(content=db.list_jobs(doc_id=doc_id))


@rag_router.get("/jobs/{job_id}")
def get_job(job_id: str):
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return JSONResponse(content=job)


# ---------------------------------------------------------------------------
# Background task implementation
# ---------------------------------------------------------------------------

def _run_extraction_job(
    job_id: str,
    doc: dict,
    mechanism: str,
    api_key: str,
    model: str,
) -> None:
    """Runs in a background thread via FastAPI BackgroundTasks."""
    import warnings
    warnings.filterwarnings("ignore")
    from app.services.pdf_extractor import (
        detect_figures, extract_signal_hints,
        extract_timing_from_chunk, validate_and_fix, to_wavedrom,
        extract_from_protocol_spec,
        _openai_client,
    )

    db.update_job(job_id, status="running")
    logger.info("Job %s starting on %s (mechanism=%r, model=%s)", job_id, doc["filename"], mechanism, model)

    # -------------------------------------------------------------------------
    # Mode A: Rule-Based / Protocol Specification Extractor (Offline / 0 Tokens)
    # -------------------------------------------------------------------------
    if model == "rule_based":
        try:
            protocol = doc.get("protocol") or ""
            results = extract_from_protocol_spec(protocol=protocol, mechanism=mechanism)
            
            for res in results:
                db.insert_diagram(
                    doc_id=doc["id"],
                    mechanism=res.get("mechanism") or mechanism or protocol or "waveform",
                    figure_number=res.get("figure_number"),
                    caption=res.get("caption"),
                    page_number=res.get("page_number", 1),
                    figure_image_path=None,
                    timing_json=res["timing_json"],
                    wavedrom_json=res.get("wavedrom_json"),
                )

            if results:
                db.update_job(
                    job_id,
                    status="completed",
                    progress=len(results),
                    total=len(results),
                    error=None,
                    finished_at=db._now_iso(),
                )
                logger.info("Job %s (rule_based) done: %d diagrams extracted", job_id, len(results))
            else:
                db.update_job(
                    job_id,
                    status="completed",
                    progress=0,
                    total=0,
                    error=f"No matching formal timing diagrams found for protocol '{protocol}' and mechanism '{mechanism}'.",
                    finished_at=db._now_iso(),
                )
            return
        except Exception as exc:
            logger.exception("Rule-based extraction failed")
            db.update_job(
                job_id,
                status="failed",
                error=f"Rule-based extraction error: {exc}",
                finished_at=db._now_iso(),
            )
            return

    # -------------------------------------------------------------------------
    # Mode B: AI VLM Extraction (OpenAI or OpenRouter)
    # -------------------------------------------------------------------------
    try:
        # Validate API key upfront before starting the loop
        client = _openai_client(api_key)
        is_openrouter = api_key.startswith("sk-or-")

        if is_openrouter:
            # Verify OpenRouter key via auth endpoint
            import urllib.request
            import json as _json
            req = urllib.request.Request(
                "https://openrouter.ai/api/v1/auth/key",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "HTTP-Referer": "http://localhost:5175",
                    "X-Title": "FLAG Formal SVA Studio",
                },
            )
            try:
                with urllib.request.urlopen(req, timeout=12) as resp:
                    pass  # Auth verified
            except Exception as or_err:
                detail = f"OpenRouter Authentication Failed: {or_err}"
                if hasattr(or_err, "read"):
                    try:
                        detail = _json.loads(or_err.read().decode()).get("error", {}).get("message", detail)
                    except Exception:
                        pass
                db.update_job(job_id, status="failed", error=detail, finished_at=db._now_iso())
                logger.error("Job %s OpenRouter auth failed: %s", job_id, detail)
                return
        else:
            try:
                client.models.list()
            except Exception as auth_err:
                err = str(auth_err)
                if "insufficient_quota" in err or "429" in err or "quota" in err.lower():
                    detail = "OpenAI API Quota Exceeded (429): Your account has $0.00 credits or billing is inactive. Add credits at platform.openai.com/billing, or use an OpenRouter API key."
                elif "invalid_api_key" in err or "401" in err or "Incorrect API key" in err:
                    detail = "OpenAI Authentication Failed (401): Invalid API key. If using OpenRouter, make sure your key starts with 'sk-or-v1-'."
                elif "Connection error" in err or "getaddrinfo" in err:
                    detail = "Network Error: Could not connect to API endpoint. Check internet connection / proxy."
                else:
                    detail = f"API Connection Failed: {err}"

                db.update_job(
                    job_id,
                    status="failed",
                    error=detail,
                    finished_at=db._now_iso(),
                )
                logger.error("Job %s failed at auth check: %s", job_id, detail)
                return

        # Stage 1+2: Detect figures
        db.update_job(job_id, progress=0, total=0)
        chunks = detect_figures(doc["file_path"])
        logger.info("Job %s: detected %d figure chunks", job_id, len(chunks))

        if not chunks:
            db.update_job(
                job_id, status="completed", progress=0, total=0,
                error="No timing-diagram-like pages found in this PDF.",
                finished_at=db._now_iso(),
            )
            return

        # Apply mechanism filter
        if mechanism:
            mech_lc = mechanism.lower()
            relevant = [
                c for c in chunks
                if mech_lc in c.caption.lower() or mech_lc in c.description.lower()
            ]
            if relevant:
                chunks = relevant

        total = len(chunks)
        db.update_job(job_id, total=total, progress=0)

        results = []
        vlm_skipped = 0
        vlm_invalid = 0

        for idx, chunk in enumerate(chunks):
            db.update_job(job_id, progress=idx)

            signal_hints = extract_signal_hints(chunk.description)

            try:
                raw = extract_timing_from_chunk(chunk, signal_hints, client, model=model)
            except Exception as api_err:
                err_str = str(api_err)
                logger.error("Job %s API error on chunk %d (%s): %s", job_id, idx, chunk.caption, err_str)
                db.update_job(
                    job_id,
                    status="failed",
                    error=f"OpenAI API Error on figure {chunk.figure_number or idx+1}: {err_str}",
                    finished_at=db._now_iso(),
                )
                return

            if raw is None:
                vlm_skipped += 1
                continue

            fixed = validate_and_fix(raw)
            if fixed is None:
                vlm_invalid += 1
                continue

            wd = to_wavedrom(fixed)

            results.append({
                "figure_number": chunk.figure_number,
                "caption": chunk.caption,
                "page_number": chunk.page_number,
                "timing_json": fixed,
                "wavedrom_json": wd,
                "image_bytes": chunk.image_bytes,
            })

        # Persist results
        for res in results:
            fig_img_path: str | None = None
            if res.get("image_bytes"):
                safe_fig = (res.get("figure_number") or "fig").replace(" ", "_")
                img_dest = FIGURES_STORE / f"{job_id}_{safe_fig}.png"
                img_dest.write_bytes(res["image_bytes"])
                fig_img_path = str(img_dest)

            db.insert_diagram(
                doc_id=doc["id"],
                mechanism=mechanism or doc.get("protocol", "unknown"),
                figure_number=res.get("figure_number"),
                caption=res.get("caption"),
                page_number=res.get("page_number"),
                figure_image_path=fig_img_path,
                timing_json=res["timing_json"],
                wavedrom_json=res.get("wavedrom_json"),
            )

        completion_error = None
        if len(results) == 0:
            completion_error = (
                f"Extracted 0 diagrams. {vlm_skipped} figure(s) were evaluated by the model as non-timing drawings. "
                f"Try specifying a mechanism query (e.g. 'handshake' or 'reset') to focus on the exact timing chapter."
            )

        db.update_job(
            job_id,
            status="completed",
            progress=len(results),
            total=total,
            error=completion_error,
            finished_at=db._now_iso(),
        )
        logger.info("Job %s done: %d diagrams extracted", job_id, len(results))

    except Exception as exc:
        logger.exception("Job %s failed with exception", job_id)
        db.update_job(
            job_id,
            status="failed",
            error=str(exc),
            finished_at=db._now_iso(),
        )
