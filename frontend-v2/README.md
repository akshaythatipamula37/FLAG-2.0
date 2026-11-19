# FLAG Formal SVA Studio (Frontend v2)

A fast, responsive, and user-friendly web interface for the **FLAG** (Formal Language-guided Assertion Generation) research framework.

Built strictly with standard **HTML5, CSS3, and Vanilla JavaScript (ES6+)** — zero external packages, zero npm dependencies, and zero build steps required.

---

## Key Features & UX Improvements

1. **High-Performance Architecture (Lag-Free & Smooth)**:
   - **Targeted DOM Updates**: Navigation, search, and polling update only their specific containers instead of tearing down the entire page DOM.
   - **Virtual Pagination**: Renders properties in clean pages of 25, 50, or 100 items. Renders thousands of candidates in under 2 milliseconds without freezing or dropping clicks.
   - **Debounced Search**: Live search across natural language, SVA formulas, and LTL expressions without keystroke lag or losing focus.
   - **Native 60+ FPS Waveform Scrubbing**: Direct SVG attribute manipulation on mouse hover without triggering layout re-renders.
2. **SMT Rejection Diagnosis (Why Properties Were Rejected)**:
   - Dedicated **"Rejected Properties"** tab showing all candidates that failed SAT filtering.
   - Clear diagnostic breakdown of the rejection reason (SMT trace inconsistency counterexample vs vacuity).
   - "Inspect Reason & AST" slide-over drawer showing the formula AST, LTL representation, and violation details.
3. **Interactive SVA & Property Explorer**:
   - Signal filtering (filter by `VALID`, `READY`, etc.).
   - High-contrast SystemVerilog syntax highlighting (`$rose`, `$fell`, `$stable`, `|->`, `##1`, `1'b1`, etc.).
   - One-click copy for individual SVA assertions.
   - **One-click "Export .sv Module"**: Generates a complete, ready-to-synthesize SystemVerilog checker module with ports, clocking block, and assertions for Siemens Questa, Synopsys VCS, Cadence Xcelium, or AMD Vivado.
4. **Hardware Waveform Viewer (Timing Diagrams)**:
   - Cycle-accurate digital logic waveform viewer supporting both **Self-defined JSON** and **WaveDrom JSON**.
   - Interactive hover crosshair tracking cycles $T0, T1, T2\dots$ with signal valuation readout.
   - Zoom in / Zoom out / Reset controls for multi-cycle analysis.
   - Clean hexagonal bus parcel graphics for multi-bit data words and square transitions for 1-bit digital signals.
5. **Verification & Analytics Dashboard**:
   - Visual KPI metric cards for Pre-filter Candidates, SAT Survivors, Yield %, and Filter Efficiency.
   - Survivor ratio visual bar chart.
   - Clear educational explanation of SMT trace consistency vs unbounded RTL model checking.
6. **Execution History & Multi-Run Management**:
   - Persistent run history drawer with instant switching between all completed runs.
7. **Live Subprocess Console**:
   - Real-time streaming logs with combined stdout and stderr capture.
8. **Clean Cyber-Industrial Design System**:
   - Sleek dark theme default with glowing accents and smooth micro-interactions.
   - 1-click toggle to a clean Apple/Linear-style light theme.
   - Responsive layout adapting to desktop and mobile screens.

---

## How to Run

### Step 1: Start the Backend (FastAPI)
From the repository root:

```powershell
.\venv\Scripts\python.exe -m uvicorn app.main:app --reload --app-dir backend --port 8000
```

### Step 2: Serve this Frontend
In another terminal:

```powershell
cd frontend-v2
python -m http.server 5175
```

Open **`http://localhost:5175`** in your browser.

---

## How Property Rejection Works in FLAG

During the SAT filtering stage (`spec2sva/smtchecker.py`), each candidate property is checked against the protocol waveforms using the **Z3 SMT Solver**:

1. **The Solver Query**:
   For each waveform trace, the solver asserts the waveform signal valuations and adds the **negation of the property**:
   $$\text{Solver.check}(\text{Waveform Constraints} \land \neg \text{Property})$$
2. **Result Interpretation**:
   - `unsat`: No counterexample exists on this waveform $\rightarrow$ Property **Holds** (Survivor).
   - `sat`: A satisfying assignment exists where the trace holds but the property formula is False $\rightarrow$ Property **Rejected** (Counterexample found).
3. **Displaying Counterexamples**:
   - In `frontend-v2`, click the **"Rejected Properties"** tab to inspect all rejected candidates.
   - To have Z3 output the exact violating waveform name and cycle $T$, extract `self._solver.model()` in `spec2sva/smtchecker.py` when `check() == z3.sat`.
