import json
from pathlib import Path

from fastapi import HTTPException

from app.schemas import (
    CatalogCounts,
    CatalogResponse,
    InputFile,
    InputsResponse,
    TestCase,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def _relative(path: Path) -> str:
    return path.relative_to(REPOSITORY_ROOT).as_posix()


def _timing_format(path: Path) -> str | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("signals"), list):
        return None
    waveforms = data.get("waveforms")
    if not isinstance(waveforms, list) or not waveforms:
        return None
    if all(
        isinstance(item, dict)
        and isinstance(item.get("signals"), list)
        and item["signals"]
        and all(isinstance(lane, dict) and isinstance(lane.get("values"), list) for lane in item["signals"])
        for item in waveforms
    ):
        return "self_defined_json"
    if all(
        isinstance(item, dict)
        and isinstance(item.get("signal"), list)
        and item["signal"]
        and all(
            isinstance(lane, dict)
            and isinstance(lane.get("wave"), str)
            and set(lane["wave"]) <= {"0", "1", "x", "=", "."}
            and ("data" not in lane or isinstance(lane["data"], list))
            for lane in item["signal"]
        )
        for item in waveforms
    ):
        return "wavedrom_json"
    return None


def discover_inputs() -> list[InputFile]:
    inputs: list[InputFile] = []
    grammar_root = REPOSITORY_ROOT / "grammar"
    if grammar_root.is_dir():
        for path in sorted(grammar_root.rglob("*.json")):
            if path.is_file():
                inputs.append(InputFile(path=_relative(path), kind="grammar", format="json"))

    test_root = REPOSITORY_ROOT / "test_cases"
    if test_root.is_dir():
        for path in sorted(test_root.rglob("timing_diagrams*.json")):
            fmt = _timing_format(path)
            if fmt is None:
                continue
            relative_parts = path.relative_to(test_root).parts
            protocol = relative_parts[0] if relative_parts else None
            mechanism = relative_parts[1] if len(relative_parts) > 2 else None
            inputs.append(InputFile(
                path=_relative(path), kind="timing_diagram", format=fmt,
                protocol=protocol, mechanism=mechanism,
            ))
        for path in sorted(test_root.rglob("*.pdf")):
            if path.is_file():
                relative_parts = path.relative_to(test_root).parts
                inputs.append(InputFile(
                    path=_relative(path), kind="specification", format="pdf",
                    protocol=relative_parts[0] if relative_parts else None,
                ))
    return inputs


def catalog() -> CatalogResponse:
    inputs = discover_inputs()
    grammars = [item for item in inputs if item.kind == "grammar"]
    timing = [item for item in inputs if item.kind == "timing_diagram"]
    specifications = [item for item in inputs if item.kind == "specification"]

    cases: dict[tuple[str, str], dict[str, set[str]]] = {}
    for item in timing:
        if item.protocol and item.mechanism:
            entry = cases.setdefault((item.protocol, item.mechanism), {"timing": set(), "specifications": set()})
            entry["timing"].add(item.path)
    for item in specifications:
        if item.protocol:
            matching = [key for key in cases if key[0] == item.protocol]
            for key in matching:
                cases[key]["specifications"].add(item.path)

    test_cases = [
        TestCase(protocol=protocol, mechanism=mechanism,
                 timing_diagram_files=sorted(data["timing"]),
                 specification_files=sorted(data["specifications"]))
        for (protocol, mechanism), data in sorted(cases.items())
    ]
    protocols = sorted({case.protocol for case in test_cases})
    return CatalogResponse(
        protocol_families=protocols,
        test_cases=test_cases,
        grammar_files=grammars,
        timing_diagram_files=timing,
        specification_files=specifications,
        counts=CatalogCounts(
            protocols=len(protocols), test_cases=len(test_cases), grammars=len(grammars),
            timing_diagrams=len(timing), specifications=len(specifications),
        ),
    )


def inputs_response() -> InputsResponse:
    return InputsResponse(inputs=discover_inputs())


def validate_discovered_path(relative_path: str, allowed_kinds: set[str] | None = None) -> Path:
    available = {item.path: item for item in discover_inputs()}
    item = available.get(relative_path)
    if item is None or (allowed_kinds is not None and item.kind not in allowed_kinds):
        raise HTTPException(status_code=422, detail="Selected path is not an available repository input.")
    candidate = (REPOSITORY_ROOT / relative_path).resolve()
    try:
        candidate.relative_to(REPOSITORY_ROOT)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Selected path is outside the repository.") from exc
    if not candidate.is_file():
        raise HTTPException(status_code=422, detail="Selected input file is unavailable.")
    return candidate


def input_item(relative_path: str) -> InputFile:
    for item in discover_inputs():
        if item.path == relative_path:
            return item
    raise HTTPException(status_code=404, detail="Input file not found.")
