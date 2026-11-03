# FLAG FastAPI adapter

This service discovers repository inputs and runs the existing `spec2sva.py` CLI in isolated per-run output directories. It does not change the FLAG core or any checked-in experiment output.

## Environment

The FLAG core requires Python 3.10+ and Z3. Prefer the repository environment if its Python interpreter is available:

```powershell
.\venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

If that environment points to an unavailable Python installation, create a new environment from the repository root and install backend plus core dependencies:

```powershell
py -3.11 -m venv .venv
  
python -m pip install -r backend\requirements.txt
```

If PowerShell blocks activation, call the environment executable directly:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

Run the API from the repository root so its working directory is unambiguous:

```powershell
```

Interactive API docs are at `http://127.0.0.1:8000/docs`.

## API

- `GET /api/health`, `/api/catalog`, `/api/inputs`
- `GET /api/inputs/{repository-relative-path}` (JSON inputs; PDFs are returned as files)
- `POST /api/runs` with `grammar_path`, `timing_diagram_path`, `mode` (`all`, `g2t`, `t2p`), and `verbose`
- `GET /api/runs/{run_id}`, `/logs`, `/artifacts`
- `GET /api/runs/{run_id}/artifacts/{filename}`

Run metadata and logs are stored under `backend/data/runs/`; generated artifacts are stored under each run's `artifacts/` directory. The run API accepts only catalog-discovered grammar and timing-diagram paths and invokes Python without a shell.


TO RUN:

.\venv\Scripts\python.exe -m uvicorn app.main:app --reload --app-dir backend

cd frontend
npm.cmd install
npm.cmd run dev
