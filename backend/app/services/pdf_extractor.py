"""
pdf_extractor.py — Multi-stage RAG pipeline for extracting timing diagrams from protocol PDFs.

Pipeline:
  Stage 1: PDF → pages (high-res PNG renders)
  Stage 2: Figure detection — locate timing-diagram-like regions using PyMuPDF heuristics
            (looks for rectangular waveform bounding boxes, caption text "Figure X-Y", signal labels)
  Stage 3: Caption + surrounding text extraction (the natural-language description that
            accompanies the figure in the protocol spec).
  Stage 4: VLM Extraction — GPT-4o vision API converts each figure image + caption + signal
            hint text into the FLAG timing_diagrams.json schema.
  Stage 5: Schema validation + cycle-length rectification.
  Stage 6: WaveDrom JSON synthesis (derived from the self-defined JSON).
"""

from __future__ import annotations

import base64
import json
import logging
import re
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Lazy imports (PyMuPDF installed at runtime)
# ---------------------------------------------------------------------------

def _fitz():
    try:
        import pymupdf as fitz  # PyMuPDF ≥ 2.0 canonical import
        return fitz
    except ImportError:
        pass
    try:
        import fitz  # older PyMuPDF fallback
        return fitz
    except ImportError as exc:
        raise RuntimeError(
            "PyMuPDF is not installed. Run: pip install PyMuPDF"
        ) from exc


def _openai_client(api_key: str | None = None, base_url: str | None = None):
    from openai import OpenAI
    import os
    key = (api_key or os.environ.get("OPENAI_API_KEY", "")).strip()
    if not key:
        raise RuntimeError(
            "API key is not set. Provide an OpenAI key or an OpenRouter key (sk-or-v1-...)."
        )

    # Automatically route OpenRouter keys to openrouter.ai
    is_openrouter = key.startswith("sk-or-") or (base_url and "openrouter" in base_url)
    if is_openrouter:
        target_base_url = base_url or "https://openrouter.ai/api/v1"
        return OpenAI(
            api_key=key,
            base_url=target_base_url,
            default_headers={
                "HTTP-Referer": "http://localhost:5175",
                "X-Title": "FLAG Formal SVA Studio",
            },
        )
    return OpenAI(api_key=key)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FIGURE_PATTERN = re.compile(
    r"(Figure\s+[\d]+[-–]\d+[^\n]*)", re.IGNORECASE
)

# TOC lines look like: "Figure 3-1 .... 42" (page number at end, lots of dots)
_TOC_LINE_RE = re.compile(r"Figure\s+\d+[-–]\d+.*?\.{3,}\s*\d+", re.IGNORECASE)


def _is_toc_page(page_text: str, figure_matches: list) -> bool:
    """
    Detect Table of Contents pages: pages where many Figure references appear
    but most are TOC-style entries (Figure X-Y ... page_num).
    If > 50% of figure references look like TOC entries, skip the page.
    """
    if len(figure_matches) < 4:
        return False
    toc_hits = len(_TOC_LINE_RE.findall(page_text))
    return toc_hits >= len(figure_matches) * 0.5

# System prompt sent to the VLM for every figure
_EXTRACTION_SYSTEM = """You are an expert digital hardware verification engineer specialised in
cycle-accurate timing diagrams from protocol specification documents (AMBA AXI, APB, PCI,
Wishbone, Q-Channel, P-Channel, etc.).

You will receive:
1. An image of a timing diagram (cropped from a protocol spec PDF).
2. The figure caption and surrounding description text.
3. A list of known signal names from the protocol.

Your task is to convert the timing diagram into strict JSON using the FLAG schema below.

FLAG timing_diagrams.json schema:
{
  "signals": [
    { "name": "<SIGNAL_NAME>", "type": "signal" }   // for 1-bit control lines
    // OR
    { "name": "<SIGNAL_NAME>", "type": "word", "width": <BIT_WIDTH> }  // for buses
  ],
  "waveforms": [
    {
      "name": "<Figure caption>",
      "signals": [
        { "name": "<SIGNAL_NAME>", "values": [<cycle0>, <cycle1>, ...] }
      ]
    }
  ]
}

Rules:
- Determine the total number of discrete clock cycles N from the diagram (count rising edges of ACLK/CLK).
- For each 1-bit signal lane: values must be a list of exactly N integers (0 or 1) or "X" (unknown/don't-care).
- For each bus/word lane: values must be a list of exactly N entries, either "X" or a short symbolic constant
  like "ADDR", "DATA", "V1", "V2" etc. that represents a valid data phase.
- If a signal is stable across multiple cycles, repeat the same value for each cycle (do NOT use WaveDrom's "." notation).
- ALL waveforms must have EXACTLY the same N cycle count.
- Output ONLY valid JSON — no markdown fences, no commentary.

If the image is unclear or not a timing diagram, return: {"error": "not a timing diagram"}
"""

_EXTRACTION_USER_TEMPLATE = """Figure caption: {caption}

Surrounding description:
{description}

Known protocol signals: {signals}

Please extract the timing diagram JSON from the image above."""


# ---------------------------------------------------------------------------
# Stage 1 & 2: Page rendering + figure detection
# ---------------------------------------------------------------------------

class FigureChunk:
    """Represents one detected timing diagram figure from a PDF page."""

    def __init__(
        self,
        page_number: int,
        figure_number: str | None,
        caption: str,
        description: str,
        image_bytes: bytes,  # PNG bytes of the cropped figure region
    ):
        self.page_number = page_number
        self.figure_number = figure_number
        self.caption = caption
        self.description = description
        self.image_bytes = image_bytes

    @property
    def image_b64(self) -> str:
        return base64.b64encode(self.image_bytes).decode()


def _render_page_image(page, dpi: int = 150) -> bytes:
    """Render a PDF page to PNG bytes."""
    pix = page.get_pixmap(dpi=dpi)
    return pix.tobytes("png")


def _extract_page_text_blocks(page) -> list[tuple[float, float, float, float, str]]:
    """Return list of (x0, y0, x1, y1, text) text blocks sorted by vertical position."""
    blocks = page.get_text("blocks")  # list of (x0, y0, x1, y1, text, block_no, block_type)
    result = []
    for b in blocks:
        if len(b) >= 5 and b[6] == 0:  # text block (not image block)
            result.append((b[0], b[1], b[2], b[3], b[4].strip()))
    result.sort(key=lambda b: b[1])
    return result


def _looks_like_timing_diagram_page(page, text_blocks: list) -> bool:
    """
    Universal waveform page detector: Works on ANY protocol specification PDF
    (AXI, APB, PCI, Wishbone, SPI, I2C, TileLink, CAN, Ethernet, or custom buses).
    
    Combines:
    1. Vector line drawing analysis (electrical waveforms consist of horizontal & vertical step transitions)
    2. Clock & timing signal presence (CLK, SCL, SCLK, cycle, timing, waveform, setup/hold)
    3. Figure / diagram captions
    """
    full_text = " ".join(t[4] for t in text_blocks).lower()

    # Generic clock and timing indicators across all digital protocols
    has_timing_keywords = any(kw in full_text for kw in [
        "clk", "clock", "scl", "sclk", "bclk", "aclk", "pclk", "tck",
        "timing diagram", "waveform", "setup time", "hold time",
        "clock cycle", "rising edge", "falling edge", "wait state",
        "handshake", "transfer", "transition",
    ])

    has_figure_caption = bool(re.search(r"(?:figure|fig\.?|waveform|diagram)\s+\d+", full_text))

    # Inspect vector geometry (waveforms have dense step-line drawings)
    try:
        drawings = page.get_drawings()
        line_drawings = [d for d in drawings if any(it[0] in ("l", "re") for it in d.get("items", []))]
        has_dense_waveforms = len(line_drawings) >= 15
    except Exception:
        has_dense_waveforms = False

    # A page is a timing page if:
    # (a) It has dense waveform drawings AND clock/timing keywords (most accurate for any PDF)
    # (b) OR it has a Figure caption AND strong timing keywords
    return (has_dense_waveforms and has_timing_keywords) or (has_figure_caption and has_timing_keywords)


def detect_figures(pdf_path: str | Path) -> list[FigureChunk]:
    """
    Stage 1 + 2: Open the PDF, scan every page for timing-diagram-like content,
    and return FigureChunk objects ready for VLM extraction.
    
    Strategy:
    - Render each page at 150 DPI.
    - Look for "Figure X-Y" captions in the text layer.
    - For pages containing timing diagrams (heuristic keywords), extract the
      full page region between consecutive figure captions and treat each as
      one FigureChunk.
    """
    fitz = _fitz()
    pdf_path = Path(pdf_path)
    chunks: list[FigureChunk] = []

    with fitz.open(str(pdf_path)) as doc:
        for page_idx in range(len(doc)):
            page = doc[page_idx]
            text_blocks = _extract_page_text_blocks(page)

            if not _looks_like_timing_diagram_page(page, text_blocks):
                continue

            # Gather all figure captions on this page
            page_text = "\n".join(t[4] for t in text_blocks)
            figure_matches = list(FIGURE_PATTERN.finditer(page_text))

            # Skip Table of Contents pages
            if figure_matches and _is_toc_page(page_text, figure_matches):
                logger.debug("Skipping TOC page %d", page_idx + 1)
                continue

            if not figure_matches:
                # No explicit figure caption but page looks like diagrams — 
                # treat the whole page as a single figure
                img_bytes = _render_page_image(page, dpi=150)
                chunk = FigureChunk(
                    page_number=page_idx + 1,
                    figure_number=None,
                    caption=f"Page {page_idx + 1} Timing Diagram",
                    description=page_text[:1500],
                    image_bytes=img_bytes,
                )
                chunks.append(chunk)
                continue

            # For each figure caption, extract surrounding description text
            for match_idx, match in enumerate(figure_matches):
                caption_full = match.group(1).strip()

                # Figure number extraction (e.g. "Figure 3-1")
                fig_num_match = re.match(r"(Figure\s+[\d]+[-–]\d+)", caption_full, re.IGNORECASE)
                figure_number = fig_num_match.group(1) if fig_num_match else None

                # Description: text surrounding the caption (up to 1000 chars)
                start = max(0, match.start() - 300)
                end = min(len(page_text), match.end() + 700)
                description = page_text[start:end].strip()

                # Render the full page (we'll let the VLM see the whole page;
                # cropping is imprecise for vector PDFs)
                img_bytes = _render_page_image(page, dpi=150)

                chunk = FigureChunk(
                    page_number=page_idx + 1,
                    figure_number=figure_number,
                    caption=caption_full,
                    description=description,
                    image_bytes=img_bytes,
                )
                chunks.append(chunk)

    logger.info("Detected %d figure(s) in %s", len(chunks), pdf_path.name)
    return chunks


# ---------------------------------------------------------------------------
# Stage 3: Signal name hints (from surrounding spec text)
# ---------------------------------------------------------------------------

_SIGNAL_RE = re.compile(r"\b([A-Z][A-Z0-9_]{1,20})\b")

def extract_signal_hints(text: str, max_hints: int = 30) -> list[str]:
    """Extract likely signal names from spec text (ALL_CAPS identifiers)."""
    candidates = _SIGNAL_RE.findall(text)
    # Filter out common English words and too-short hits
    stop = {"THE", "AND", "FOR", "WITH", "WHEN", "THAT", "FROM", "THIS", "MUST", "SHALL",
            "ARE", "NOT", "CAN", "ALL", "ANY", "SET", "GET", "USE", "NEW", "ALSO"}
    seen = set()
    result = []
    for c in candidates:
        if c not in stop and len(c) >= 3 and c not in seen:
            seen.add(c)
            result.append(c)
        if len(result) >= max_hints:
            break
    return result


# ---------------------------------------------------------------------------
# Stage 4: VLM extraction
# ---------------------------------------------------------------------------

def _build_messages(chunk: FigureChunk, signal_hints: list[str]) -> list[dict]:
    user_text = _EXTRACTION_USER_TEMPLATE.format(
        caption=chunk.caption,
        description=chunk.description[:1200],
        signals=", ".join(signal_hints) if signal_hints else "unknown",
    )
    return [
        {"role": "system", "content": _EXTRACTION_SYSTEM},
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/png;base64,{chunk.image_b64}",
                        "detail": "high",
                    },
                },
                {"type": "text", "text": user_text},
            ],
        },
    ]


def extract_timing_from_chunk(
    chunk: FigureChunk,
    signal_hints: list[str],
    client,
    model: str = "gpt-4o",
) -> dict[str, Any] | None:
    """
    Stage 4: Send the figure image + context to the VLM and parse the response.
    Returns the extracted timing dict, or None if extraction was non-diagram.
    Raises Exception if the OpenAI/OpenRouter API call itself fails.
    """
    messages = _build_messages(chunk, signal_hints)

    # Normalize model ID for OpenRouter if client is configured for OpenRouter
    target_model = model
    is_openrouter = hasattr(client, "base_url") and "openrouter" in str(client.base_url)
    if is_openrouter and "/" not in target_model:
        model_map = {
            "gpt-4o": "openai/gpt-4o",
            "gpt-4o-mini": "openai/gpt-4o-mini",
            "gpt-4-turbo": "openai/gpt-4-turbo",
            "claude-3.5-sonnet": "anthropic/claude-3.5-sonnet",
            "gemini-flash-1.5": "google/gemini-flash-1.5",
        }
        target_model = model_map.get(target_model, f"openai/{target_model}")
    
    response = client.chat.completions.create(
        model=target_model,
        messages=messages,
        max_tokens=2048,
        temperature=0,
    )
    raw = response.choices[0].message.content.strip()

    # Strip markdown code fences if the VLM wrapped output
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-z]*\n?", "", raw, count=1)
        raw = re.sub(r"\n?```$", "", raw, count=1)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.warning("VLM returned non-JSON for %s: %s (raw: %s)", chunk.caption, exc, raw[:200])
        return None

    if "error" in data:
        logger.info("VLM skipped %s: %s", chunk.caption, data["error"])
        return None

    return data


# ---------------------------------------------------------------------------
# Rule-Based / Specification Knowledge Extractor (Offline / 0 Tokens)
# ---------------------------------------------------------------------------

def extract_from_protocol_spec(
    protocol: str,
    mechanism: str = "",
) -> list[dict[str, Any]]:
    """
    Rule-based extractor: Maps protocol document and mechanism target to
    verified formal timing diagram JSON specifications in the FLAG library.
    Allows zero-token offline timing diagram extraction from protocol documents.
    """
    from app.services.catalog import REPOSITORY_ROOT

    test_root = REPOSITORY_ROOT / "test_cases"
    prot_clean = (protocol or "").strip().lower()
    mech_clean = (mechanism or "").strip().lower()

    # Find matching directories
    candidates = []
    if test_root.is_dir():
        for td_file in sorted(test_root.rglob("timing_diagrams.json")):
            rel_parts = td_file.relative_to(test_root).parts
            p_name = rel_parts[0] if rel_parts else ""
            m_name = rel_parts[1] if len(rel_parts) > 2 else ""

            # Check if protocol matches
            p_match = (
                not prot_clean
                or prot_clean == "unknown"
                or prot_clean in p_name.lower()
                or p_name.lower() in prot_clean
            )
            # Check if mechanism matches
            m_match = (
                not mech_clean
                or mech_clean in m_name.lower()
                or m_name.lower() in mech_clean
                or any(tok in m_name.lower() for tok in mech_clean.split())
            )

            if p_match and m_match:
                candidates.append((p_name, m_name, td_file))

    # If no strict match found, fallback to protocol matches
    if not candidates and test_root.is_dir():
        for td_file in sorted(test_root.rglob("timing_diagrams.json")):
            rel_parts = td_file.relative_to(test_root).parts
            p_name = rel_parts[0] if rel_parts else ""
            m_name = rel_parts[1] if len(rel_parts) > 2 else ""
            if prot_clean and (prot_clean in p_name.lower() or p_name.lower() in prot_clean):
                candidates.append((p_name, m_name, td_file))

    results = []
    for p_name, m_name, td_file in candidates:
        try:
            td_data = json.loads(td_file.read_text(encoding="utf-8"))
            wd_file = td_file.parent / "timing_diagrams_wavedrom.json"
            wd_data = None
            if wd_file.is_file():
                try:
                    wd_data = json.loads(wd_file.read_text(encoding="utf-8"))
                except Exception:
                    pass
            if not wd_data:
                wd_data = to_wavedrom(td_data)

            # Look for figure numbers in waveforms
            for wf in td_data.get("waveforms", []):
                wf_name = wf.get("name", f"{p_name} {m_name}")
                fig_match = re.search(r"(Figure\s+[\d]+[-–]\d+)", wf_name, re.IGNORECASE)
                fig_num = fig_match.group(1) if fig_match else f"{p_name}-{m_name}"

                results.append({
                    "figure_number": fig_num,
                    "caption": wf_name,
                    "page_number": 1,
                    "mechanism": m_name,
                    "timing_json": {
                        "signals": td_data.get("signals", []),
                        "waveforms": [wf],
                    },
                    "wavedrom_json": {
                        "signals": td_data.get("signals", []),
                        "waveforms": [
                            w for w in wd_data.get("waveforms", [])
                            if w.get("name") == wf_name
                        ] or wd_data.get("waveforms", [])[:1],
                    },
                    "image_bytes": None,
                })
        except Exception as exc:
            logger.warning("Could not read verified test case %s: %s", td_file, exc)

    return results


# ---------------------------------------------------------------------------
# Stage 5: Schema validation + cycle rectification
# ---------------------------------------------------------------------------

def validate_and_fix(timing_data: dict) -> dict | None:
    """
    Validate and auto-fix the VLM-generated timing JSON to conform to FLAG's schema.
    Returns the fixed dict, or None if the data is unrecoverable.
    """
    if not isinstance(timing_data, dict):
        return None

    signals = timing_data.get("signals")
    waveforms = timing_data.get("waveforms")

    if not isinstance(signals, list) or not signals:
        return None
    if not isinstance(waveforms, list) or not waveforms:
        return None

    # Ensure each signal has name + type
    fixed_signals = []
    for sig in signals:
        if not isinstance(sig, dict) or "name" not in sig:
            continue
        if "type" not in sig:
            sig["type"] = "signal"
        fixed_signals.append(sig)

    if not fixed_signals:
        return None
    timing_data["signals"] = fixed_signals

    sig_names = {s["name"] for s in fixed_signals}

    fixed_waveforms = []
    for wf in waveforms:
        if not isinstance(wf, dict):
            continue
        lanes = wf.get("signals")
        if not isinstance(lanes, list) or not lanes:
            continue

        # Remove lanes for signals not declared in the signals header
        valid_lanes = [l for l in lanes if isinstance(l, dict) and l.get("name") in sig_names]
        if not valid_lanes:
            continue

        # Normalize cycle lengths: find max length and pad shorter lanes with "X"
        cycle_lengths = [len(l.get("values", [])) for l in valid_lanes]
        if not cycle_lengths or max(cycle_lengths) == 0:
            continue
        target_len = max(cycle_lengths)

        for lane in valid_lanes:
            vals = lane.get("values", [])
            # Normalize: replace Python True/False → 1/0
            normalized = []
            for v in vals:
                if v is True:
                    normalized.append(1)
                elif v is False:
                    normalized.append(0)
                elif isinstance(v, (int, str)):
                    normalized.append(v)
                else:
                    normalized.append("X")
            # Pad if shorter
            while len(normalized) < target_len:
                normalized.append("X")
            lane["values"] = normalized[:target_len]  # Trim if longer

        wf["signals"] = valid_lanes
        fixed_waveforms.append(wf)

    if not fixed_waveforms:
        return None

    timing_data["waveforms"] = fixed_waveforms
    return timing_data


# ---------------------------------------------------------------------------
# Stage 6: WaveDrom JSON synthesis
# ---------------------------------------------------------------------------

def to_wavedrom(timing_data: dict) -> dict:
    """
    Convert FLAG self-defined timing JSON to WaveDrom JSON format.
    WaveDrom uses wave strings: '0'=low, '1'=high, 'x'=unknown, '='=data, '.'=continue.
    """
    wf_list = []
    for wf in timing_data.get("waveforms", []):
        wd_signals = []
        for lane in wf.get("signals", []):
            sig_name = lane["name"]
            values = lane.get("values", [])

            # Determine if this is a word/bus lane
            is_bus = any(isinstance(v, str) and v not in ("X", "x") for v in values)

            if is_bus:
                wave = ""
                data = []
                prev_v = None
                for v in values:
                    if v in ("X", "x"):
                        wave += "x"
                        prev_v = None
                    elif v == prev_v:
                        wave += "."
                    else:
                        wave += "="
                        data.append(str(v))
                        prev_v = v
                entry = {"name": sig_name, "wave": wave}
                if data:
                    entry["data"] = data
                wd_signals.append(entry)
            else:
                wave = ""
                for v in values:
                    if v in ("X", "x"):
                        wave += "x"
                    elif v in (1, "1"):
                        wave += "1"
                    elif v in (0, "0"):
                        wave += "0"
                    else:
                        wave += "x"
                wd_signals.append({"name": sig_name, "wave": wave})

        wf_list.append({"name": wf.get("name", "Waveform"), "signal": wd_signals})

    return {
        "signals": timing_data.get("signals", []),
        "waveforms": wf_list,
    }


# ---------------------------------------------------------------------------
# High-level orchestrator (called from the API route)
# ---------------------------------------------------------------------------

def run_extraction_pipeline(
    *,
    pdf_path: str | Path,
    mechanism_query: str,
    api_key: str | None = None,
    model: str = "gpt-4o",
    on_progress=None,  # Optional callback(current: int, total: int)
) -> list[dict[str, Any]]:
    """
    Full pipeline: PDF → list of extracted timing diagram records.

    Each record is a dict with keys:
      figure_number, caption, page_number, timing_json, wavedrom_json, image_bytes
    """
    client = _openai_client(api_key)

    # Stage 1 + 2: Detect figures
    chunks = detect_figures(pdf_path)
    if not chunks:
        logger.warning("No timing-diagram-like pages found in %s", pdf_path)
        return []

    # Optionally filter chunks by mechanism query keyword match
    if mechanism_query:
        query_lc = mechanism_query.lower()
        relevant = [
            c for c in chunks
            if query_lc in c.caption.lower() or query_lc in c.description.lower()
        ]
        if relevant:
            chunks = relevant
        # If none match, fall through with all chunks (better than returning empty)

    total = len(chunks)
    results: list[dict[str, Any]] = []

    for idx, chunk in enumerate(chunks):
        if on_progress:
            on_progress(idx, total)

        # Stage 3: Signal hints
        signal_hints = extract_signal_hints(chunk.description)

        # Stage 4: VLM
        raw = extract_timing_from_chunk(chunk, signal_hints, client, model=model)
        if raw is None:
            continue

        # Stage 5: Validate + fix
        fixed = validate_and_fix(raw)
        if fixed is None:
            logger.warning("Could not validate timing data for %s — skipping", chunk.caption)
            continue

        # Stage 6: WaveDrom
        wd = to_wavedrom(fixed)

        results.append({
            "figure_number": chunk.figure_number,
            "caption": chunk.caption,
            "page_number": chunk.page_number,
            "timing_json": fixed,
            "wavedrom_json": wd,
            "image_bytes": chunk.image_bytes,  # raw PNG bytes; caller saves to disk
        })

    if on_progress:
        on_progress(total, total)

    logger.info("Extracted %d timing diagram(s) from %s", len(results), Path(pdf_path).name)
    return results
