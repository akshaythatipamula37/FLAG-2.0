# FLAG Research Workbench — HTML/CSS/JS

This is a separate, dependency-free browser implementation of the React workbench. It talks to the same FastAPI backend and can run alongside the React app.

## Run both frontends

Start the backend from the repository root:

```powershell
.\venv\Scripts\python.exe -m uvicorn app.main:app --reload --app-dir backend
```

In one terminal start React (URL normally `http://localhost:5173`):

```powershell
cd frontend
npm.cmd run dev
```

In another terminal serve this plain frontend at `http://localhost:5174`:

```powershell
cd frontend-vanilla
python -m http.server 5174
```

The backend CORS configuration includes both origins. If you change the vanilla server port, add its localhost origin to `backend/app/main.py`.

Set a different API address in the browser console before reloading with `localStorage.setItem('FLAG_API_BASE', 'http://127.0.0.1:8000')` (the default is already `http://127.0.0.1:8000`).
