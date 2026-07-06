# 🎨 Elysium AI — React Frontend

This directory contains the React + Vite frontend application for **Elysium AI**, a real-time financial risk intelligence dashboard.

## 🛠️ Tech Stack & Styling
- **Core:** React 19, Vite 8, JavaScript (ES modules)
- **Icons:** [lucide-react](https://lucide.dev/)
- **Linting:** [oxlint](https://oxc.rs/docs/guide/usage/linter.html) (ultra-fast JS/TS linter)
- **Styling:** Vanilla CSS (custom modern dashboard design)

---

## 🚀 Available Commands

Run these commands from the `frontend/` directory:

### 1. Install Dependencies
Installs all required package dependencies.
```bash
npm install
```

### 2. Run Development Server
Starts the local development server with Hot Module Replacement (HMR).
```bash
npm run dev
```
- Default URL: `http://localhost:5173/`
- Connects to the FastAPI backend API (by default assumes backend runs at `http://localhost:8000`).

### 3. Build for Production
Compiles and bundles the application assets into the `dist/` directory.
```bash
npm run build
```
- Output directory: `frontend/dist/`
- These built assets are automatically served by the FastAPI backend when it is run.

### 4. Run Linter
Runs `oxlint` to perform fast static analysis and syntax linting on files.
```bash
npm run lint
```

### 5. Preview Production Build
Locally preview the built application before deployment.
```bash
npm run preview
```
- Serves the compiled files from the `dist/` folder on a local port.
