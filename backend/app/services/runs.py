import asyncio
import json
import logging
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from app.schemas import RunRequest, RunResponse
from app.services.catalog import REPOSITORY_ROOT, validate_discovered_path

RUNS_ROOT = Path(__file__).resolve().parents[2] / "data" / "runs"
CLI_ENTRYPOINT = REPOSITORY_ROOT / "spec2sva.py"
logger = logging.getLogger(__name__)
_records: dict[str, dict[str, Any]] = {}
_tasks: dict[str, asyncio.Task] = {}
_records_lock = asyncio.Lock()
_process_limit = asyncio.Semaphore(2)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _metadata_path(run_id: str) -> Path:
    return RUNS_ROOT / run_id / "run.json"


def _persist(record: dict[str, Any]) -> None:
    run_dir = RUNS_ROOT / record["run_id"]
    run_dir.mkdir(parents=True, exist_ok=True)
    target = run_dir / "run.json"
    temporary = target.with_suffix(".json.tmp")
    serializable = {key: value.isoformat() if isinstance(value, datetime) else value for key, value in record.items()}
    temporary.write_text(json.dumps(serializable, indent=2), encoding="utf-8")
    temporary.replace(target)


def _load_record(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        for key in ("created_at", "started_at", "finished_at"):
            if data.get(key):
                data[key] = datetime.fromisoformat(data[key])
        if data.get("status") in {"queued", "running"}:
            data["status"] = "failed"
            data["error"] = "Backend restarted before the process completed."
            data["finished_at"] = _now()
            _persist(data)
        return data
    except (OSError, json.JSONDecodeError, ValueError):
        return None


def _ensure_loaded() -> None:
    RUNS_ROOT.mkdir(parents=True, exist_ok=True)
    for path in RUNS_ROOT.glob("*/run.json"):
        if path.parent.name in _records:
            continue
        record = _load_record(path)
        if record:
            _records[record["run_id"]] = record


def _response(record: dict[str, Any]) -> RunResponse:
    return RunResponse(**{key: record.get(key) for key in RunResponse.model_fields})


def get_run(run_id: str) -> dict[str, Any]:
    _ensure_loaded()
    record = _records.get(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Run not found.")
    return record


def run_response(run_id: str) -> RunResponse:
    return _response(get_run(run_id))


async def create_run(request: RunRequest) -> RunResponse:
    if not CLI_ENTRYPOINT.is_file():
        raise HTTPException(status_code=500, detail="FLAG CLI entrypoint is missing.")
    grammar = validate_discovered_path(request.grammar_path, {"grammar"})
    try:
        grammar_data = json.loads(grammar.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=422, detail="Grammar file is not valid UTF-8 JSON.") from exc
    if not isinstance(grammar_data, dict) or not grammar_data or not all(isinstance(value, list) and value for value in grammar_data.values()):
        raise HTTPException(status_code=422, detail="Grammar JSON must be a non-empty category-to-phrase object.")
    timing: Path | None = None
    timing_format: str | None = None
    if request.mode in {"all", "t2p"}:
        if not request.timing_diagram_path:
            raise HTTPException(status_code=422, detail="A timing diagram is required for all and t2p modes.")
        timing = validate_discovered_path(request.timing_diagram_path, {"timing_diagram"})
        from app.services.catalog import input_item
        timing_format = input_item(request.timing_diagram_path).format
        try:
            timing_data = json.loads(timing.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise HTTPException(status_code=422, detail="Timing diagram is not valid UTF-8 JSON.") from exc
        if not isinstance(timing_data, dict) or not isinstance(timing_data.get("signals"), list) or not timing_data["signals"] or not isinstance(timing_data.get("waveforms"), list) or not timing_data["waveforms"]:
            raise HTTPException(status_code=422, detail="Timing diagram JSON must contain signals and waveforms arrays.")
        for waveform in timing_data["waveforms"]:
            if not isinstance(waveform, dict):
                raise HTTPException(status_code=422, detail="Each timing diagram waveform must be an object.")
            lanes = waveform.get("signals") if timing_format == "self_defined_json" else waveform.get("signal")
            if not isinstance(lanes, list) or not lanes:
                raise HTTPException(status_code=422, detail="Each timing diagram waveform must contain signal lanes.")
            if timing_format == "self_defined_json":
                values = [lane.get("values") for lane in lanes if isinstance(lane, dict)]
                if len(values) != len(lanes) or any(not isinstance(row, list) or not row for row in values):
                    raise HTTPException(status_code=422, detail="Each self-defined timing lane must contain a non-empty values array.")
                if len({len(row) for row in values}) != 1:
                    raise HTTPException(status_code=422, detail="Timing lanes within a waveform must have equal cycle counts.")
            elif any(not isinstance(lane, dict) or not isinstance(lane.get("wave"), str) or not lane["wave"] for lane in lanes):
                raise HTTPException(status_code=422, detail="Each WaveDrom lane must contain a non-empty wave string.")
            elif len({len(lane["wave"]) for lane in lanes}) != 1:
                raise HTTPException(status_code=422, detail="WaveDrom lanes within a waveform must have equal cycle counts.")
            if timing_format == "wavedrom_json":
                for lane in lanes:
                    if set(lane["wave"]) - {"0", "1", "x", "=", "."}:
                        raise HTTPException(status_code=422, detail="WaveDrom input uses a symbol outside the supported subset.")
                    if "data" in lane and lane["wave"].count("=") > len(lane["data"]):
                        raise HTTPException(status_code=422, detail="WaveDrom lane has fewer data labels than '=' values.")
    elif request.timing_diagram_path:
        validate_discovered_path(request.timing_diagram_path, {"timing_diagram"})

    RUNS_ROOT.mkdir(parents=True, exist_ok=True)
    run_id = uuid.uuid4().hex
    (RUNS_ROOT / run_id / "artifacts").mkdir(parents=True)
    record = {
        "run_id": run_id, "status": "queued", "created_at": _now(),
        "started_at": None, "finished_at": None, "exit_code": None,
        "mode": request.mode, "grammar_path": request.grammar_path,
        "timing_diagram_path": request.timing_diagram_path,
        "verbose": request.verbose, "error": None,
    }
    _records[run_id] = record
    _persist(record)
    _tasks[run_id] = asyncio.create_task(
        _execute(run_id, request, grammar, timing, timing_format), name=f"flag-run-{run_id}"
    )
    return _response(record)


def _append_stream(stream: Any, run_id: str, label: str) -> None:
    run_dir = RUNS_ROOT / run_id
    stream_path = run_dir / f"{label}.log"
    combined_path = run_dir / "combined.log"
    while True:
        chunk = stream.readline()
        if not chunk:
            break
        text = chunk if isinstance(chunk, str) else chunk.decode("utf-8", errors="replace")
        with stream_path.open("a", encoding="utf-8") as output:
            output.write(text)
        with combined_path.open("a", encoding="utf-8") as output:
            output.write(f"[{label}] {text}")


def _base_command(mode: str, grammar: Path, timing: Path | None, output_dir: Path,
                  verbose: bool, timing_format: str | None) -> list[str]:
    command = [sys.executable, str(CLI_ENTRYPOINT), mode]
    if mode in {"all", "g2t"}:
        command.extend(["-g", str(grammar)])
    if mode == "t2p":
        raise ValueError("t2p command needs the generated template path")
    if mode == "all":
        assert timing is not None
        command.extend(["-w", str(timing)])
    if timing_format == "wavedrom_json" and mode == "all":
        command.append("-wd")
    command.extend(["-o", str(output_dir)])
    if verbose:
        command.append("--verbose")
    return command


async def _run_command(command: list[str], run_id: str) -> int:
    # asyncio's subprocess transport is unavailable with Windows' SelectorEventLoop.
    # Popen plus reader threads works with either Windows event-loop policy and keeps
    # streaming logs while the API loop remains responsive.
    process = subprocess.Popen(
        command, cwd=str(REPOSITORY_ROOT),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", errors="replace", bufsize=1,
    )
    assert process.stdout is not None and process.stderr is not None
    readers = [
        threading.Thread(target=_append_stream, args=(process.stdout, run_id, "stdout"), daemon=True),
        threading.Thread(target=_append_stream, args=(process.stderr, run_id, "stderr"), daemon=True),
    ]
    for reader in readers:
        reader.start()
    exit_code = await asyncio.to_thread(process.wait)
    for reader in readers:
        await asyncio.to_thread(reader.join)
    return exit_code


async def _execute(run_id: str, request: RunRequest, grammar: Path,
                   timing: Path | None, timing_format: str | None) -> None:
    record = _records[run_id]
    run_dir = RUNS_ROOT / run_id
    output_dir = run_dir / "artifacts"
    async with _process_limit:
        record["status"] = "running"
        record["started_at"] = _now()
        _persist(record)
        try:
            if request.mode == "t2p":
                assert timing is not None
                with tempfile.TemporaryDirectory(prefix="templates-", dir=run_dir) as temp_dir:
                    template_dir = Path(temp_dir)
                    g2t_command = _base_command("g2t", grammar, None, template_dir, False, None)
                    first_code = await _run_command(g2t_command, run_id)
                    if first_code != 0:
                        raise RuntimeError(f"G2T preparation exited with status {first_code}.")
                    for name in ("templates.json", "templates_NL.json"):
                        source = template_dir / name
                        if source.exists():
                            shutil.copy2(source, output_dir / name)
                    t2p_command = [sys.executable, str(CLI_ENTRYPOINT), "t2p", "-t",
                                   str(template_dir / "templates.json"), "-w", str(timing), "-o", str(output_dir)]
                    if timing_format == "wavedrom_json":
                        t2p_command.append("-wd")
                    if request.verbose:
                        t2p_command.append("--verbose")
                    exit_code = await _run_command(t2p_command, run_id)
            else:
                command = _base_command(request.mode, grammar, timing, output_dir,
                                        request.verbose, timing_format)
                exit_code = await _run_command(command, run_id)
            record["exit_code"] = exit_code
            record["status"] = "completed" if exit_code == 0 else "failed"
            if exit_code != 0:
                record["error"] = f"FLAG process exited with status {exit_code}."
        except Exception as exc:  # persist process and orchestration failures for the UI
            logger.exception("FLAG run %s failed", run_id)
            record["status"] = "failed"
            record["error"] = str(exc)
        finally:
            record["finished_at"] = _now()
            _persist(record)


def list_artifacts(run_id: str) -> list[dict[str, Any]]:
    get_run(run_id)
    root = (RUNS_ROOT / run_id / "artifacts").resolve()
    artifacts = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        try:
            path.resolve().relative_to(root)
        except ValueError:
            continue
        artifacts.append({
            "filename": path.name,
            "path": path.relative_to(root).as_posix(),
            "size_bytes": path.stat().st_size,
            "format": path.suffix.lstrip(".").lower() or "file",
        })
    return artifacts


def artifact_path(run_id: str, relative_filename: str) -> Path:
    get_run(run_id)
    root = (RUNS_ROOT / run_id / "artifacts").resolve()
    if not relative_filename or "\\" in relative_filename:
        raise HTTPException(status_code=404, detail="Artifact not found.")
    path = (root / relative_filename).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Artifact not found.") from exc
    if not path.is_file() or path.suffix.lower() != ".json":
        raise HTTPException(status_code=404, detail="JSON artifact not found.")
    return path


def read_logs(run_id: str) -> dict[str, str]:
    record = get_run(run_id)
    run_dir = RUNS_ROOT / run_id
    def read(name: str) -> str:
        try:
            return (run_dir / name).read_text(encoding="utf-8")
        except FileNotFoundError:
            return ""
    return {"run_id": run_id, "status": record["status"],
            "stdout": read("stdout.log"), "stderr": read("stderr.log"),
            "combined": read("combined.log")}
