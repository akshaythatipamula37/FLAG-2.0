# FLAG FastAPI adapter

This service discovers repository inputs and runs the existing `spec2sva.py` CLI in isolated per-run output directories. It does not change the FLAG core or any checked-in experiment output.

## Environment

The FLAG core requires Python 3.10+ and Z3. The API runs the CLI with the same Python interpreter that launched Uvicorn, so install the dependencies into that interpreter. If the existing `venv` cannot start because its original Python installation was removed, install Python 3.11, then recreate `.venv` and install the dependencies from the repository root:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

Run the API from the repository root so its working directory is unambiguous:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --app-dir backend
```

Interactive API docs are at `http://127.0.0.1:8000/docs`.

## API

- `GET /api/health`, `/api/catalog`, `/api/inputs`
- `GET /api/inputs/{repository-relative-path}` (JSON inputs; PDFs are returned as files)
- `POST /api/runs` with `grammar_path`, `timing_diagram_path`, `mode` (`all`, `g2t`, `t2p`), and `verbose`
- `GET /api/runs/{run_id}`, `/logs`, `/artifacts`
- `GET /api/runs/{run_id}/artifacts/{filename}`

Run metadata and logs are stored under `backend/data/runs/`; generated artifacts are stored under each run's `artifacts/` directory. The run API accepts only catalog-discovered grammar and timing-diagram paths and invokes Python without a shell.

## Run a frontend

After starting the API, open a second terminal for the frontend.

For the modern **FLAG Studio (frontend-v2)**:

```powershell
cd frontend-v2
python -m http.server 5175
```

Open `http://localhost:5175` in your browser.

For the legacy vanilla frontend:

```powershell
cd frontend
python -m http.server 5174
```
