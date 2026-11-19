"""
Standalone smoke test for the RAG pdf_extractor pipeline (no VLM API needed).
Tests Stages 1-3 and Stage 5-6 (figure detection, signal hints, schema fix, wavedrom).
Stage 4 (VLM) is stubbed with a realistic mock output.

Run from the project root:
    venv\Scripts\python.exe backend\app\services\test_extractor.py test_cases/AXI/AMBAaxi.pdf
"""

import json
import sys
from pathlib import Path

# Insert backend onto path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.services.pdf_extractor import (
    detect_figures,
    extract_signal_hints,
    validate_and_fix,
    to_wavedrom,
)

PDF_PATH = sys.argv[1] if len(sys.argv) > 1 else "test_cases/AXI/AMBAaxi.pdf"

print(f"\n=== FLAG RAG Extractor Smoke Test ===")
print(f"PDF: {PDF_PATH}\n")

# --- Stage 1+2: Figure Detection ---
print("Stage 1+2: Detecting figures...")
chunks = detect_figures(PDF_PATH)
print(f"  Found {len(chunks)} figure chunk(s)\n")
for i, c in enumerate(chunks[:5]):  # show first 5
    print(f"  [{i}] Page {c.page_number} | {c.figure_number or 'no fig#'} | {c.caption[:60]}...")
    print(f"       Image: {len(c.image_bytes)} bytes PNG")
if len(chunks) > 5:
    print(f"  ... and {len(chunks)-5} more\n")

# --- Stage 3: Signal hints ---
if chunks:
    print("\nStage 3: Signal hints from first chunk:")
    hints = extract_signal_hints(chunks[0].description)
    print(f"  {hints[:15]}")

# --- Stage 5: Validate & Fix (with mock VLM output) ---
print("\nStage 5: Schema validation & fix...")
mock_vlm_output = {
    "signals": [
        {"name": "VALID"},        # missing type (should be fixed to "signal")
        {"name": "READY", "type": "signal"},
        {"name": "DATA", "type": "word", "width": 8},
    ],
    "waveforms": [
        {
            "name": "Figure 3-1: VALID before READY",
            "signals": [
                {"name": "VALID", "values": [0, 1, 1, 0]},
                {"name": "READY", "values": [0, 0, 1]},   # <-- short by 1 (should be padded)
                {"name": "DATA",  "values": ["X", "X", "0xAB", "X"]},
                {"name": "UNKNOWN_SIG", "values": [0, 1, 0, 0]},  # <-- not in signals, should be dropped
            ]
        }
    ]
}
fixed = validate_and_fix(mock_vlm_output)
print(f"  Fixed signals: {[s['name'] for s in fixed['signals']]}")
print(f"  Signal types: {[s['type'] for s in fixed['signals']]}")
wf = fixed['waveforms'][0]
for lane in wf['signals']:
    print(f"  Lane {lane['name']}: {lane['values']} (len={len(lane['values'])})")
assert all(len(l['values']) == 4 for l in wf['signals']), "Cycle lengths not equal!"
assert all(s['type'] in ('signal','word') for s in fixed['signals']), "Missing type!"
assert not any(l['name'] == 'UNKNOWN_SIG' for l in wf['signals']), "UNKNOWN_SIG not dropped!"
print("  Stage 5 PASSED\n")

# --- Stage 6: WaveDrom ---
print("Stage 6: WaveDrom synthesis...")
wd = to_wavedrom(fixed)
for wf_wd in wd['waveforms']:
    print(f"  Waveform: {wf_wd['name']}")
    for lane in wf_wd['signal']:
        print(f"    {lane['name']}: wave={lane['wave']}", end='')
        if 'data' in lane:
            print(f" data={lane['data']}", end='')
        print()
print("  Stage 6 PASSED\n")

print("=== ALL SMOKE TESTS PASSED ===\n")
