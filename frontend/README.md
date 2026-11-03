# FLAG Research Workbench

Frontend-only React/Vite foundation for the FLAG research dashboard. It uses clearly labeled demo content and does not connect to the FLAG pipeline or a backend.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Start the development server

From this directory:

```bash
npm.cmd install
npm.cmd run dev
```

Vite prints the local URL after startup. To create a static production build, run `npm run build`; to serve that build locally, run `npm run preview`.

## Connect the FastAPI backend

In a second terminal, follow [the backend setup](../backend/README.md) and start Uvicorn at `http://127.0.0.1:8000`. The Vite development origin is allowed by backend CORS. To use a different API address, create `frontend/.env.local` with:

```text
VITE_API_BASE_URL=http://127.0.0.1:8000
```

## Stack

- React with JavaScript and Vite
- Tailwind CSS v4 through its Vite plugin
- Lucide icons
- Recharts and Monaco Editor dependencies are included for future explorer views
- `components.json` records the shadcn/ui project configuration; the current foundation uses small local reusable components and does not require generated shadcn components yet

All demo values and artifact rows live in `src/data/demo.js`. They describe repository structure and artifact formats; they are not results from a FLAG execution.
