"""
Diagnostic script: traces what happens inside run_extraction_pipeline WITHOUT calling the VLM.
Run:  venv\Scripts\python.exe backend\diag_extraction.py <doc_id>
"""
import sys, json
sys.path.insert(0, 'backend')
import warnings; warnings.filterwarnings('ignore')

from app.services import rag_db as db
from app.services.pdf_extractor import detect_figures, extract_signal_hints

# Get the doc
docs = db.list_documents()
if not docs:
    print("No documents in DB. Upload a PDF first.")
    sys.exit(1)

doc = docs[0]
print(f"Doc: {doc['filename']}  protocol={doc['protocol']}")
print(f"File path: {doc['file_path']}")
print()

# Check file exists
from pathlib import Path
if not Path(doc['file_path']).is_file():
    print("ERROR: PDF file is missing on disk!")
    sys.exit(1)

# Stage 1+2: Figure detection
print("=== Stage 1+2: Figure Detection ===")
chunks = detect_figures(doc['file_path'])
print(f"Total chunks detected: {len(chunks)}")
for i, c in enumerate(chunks[:10]):
    print(f"  [{i:2d}] p{c.page_number:3d} | {(c.figure_number or '?'):12s} | {c.caption[:50]}")
if len(chunks) > 10:
    print(f"  ... and {len(chunks)-10} more")

print()

# Check mechanism filtering (simulates what run_extraction_pipeline does)
jobs = db.list_jobs()
mech = jobs[0]['mechanism'] if jobs else ''
print(f"=== Mechanism filter: '{mech}' ===")
if mech:
    mech_lc = mech.lower()
    relevant = [c for c in chunks if mech_lc in c.caption.lower() or mech_lc in c.description.lower()]
    print(f"Chunks matching query: {len(relevant)}")
    for c in relevant[:5]:
        print(f"  p{c.page_number} | {c.figure_number}: {c.caption[:60]}")
    if not relevant:
        print("  PROBLEM: No chunks match the mechanism query -> pipeline returns 0 results")
        print()
        print("  First 3 chunk captions for reference:")
        for c in chunks[:3]:
            print(f"    '{c.caption[:80]}'")
else:
    print("No mechanism filter -> all chunks passed to VLM")

print()

# Stage 3: Signal hints for first chunk
if chunks:
    print("=== Stage 3: Signal Hints (first chunk) ===")
    hints = extract_signal_hints(chunks[0].description)
    print(f"Hints: {hints[:20]}")

print()
print("=== DIAGNOSIS COMPLETE ===")
print("If 0 chunks matched the mechanism filter, the fix is to broaden the mechanism query or leave it blank.")
print("If chunks were found, the VLM API is the issue (key/connectivity/response format).")
