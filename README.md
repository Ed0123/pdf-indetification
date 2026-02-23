# PDF Text Extraction Tool — Web App

A browser-based PDF text extraction tool that lets you import PDFs, draw extraction boxes, run OCR, and export results to Excel.

Built with **React + Vite** (frontend) and **FastAPI + PyMuPDF** (backend), deployable to **Firebase Hosting** (frontend) + **Google Cloud Run** (backend).

---

## Architecture

```
┌──────────────────────────────┐        ┌────────────────────────────────┐
│  Firebase Hosting             │  HTTP  │  Google Cloud Run              │
│  React + Vite (TypeScript)   │ ──────▶│  FastAPI + PyMuPDF + Tesseract │
│  frontend/                   │        │  backend/                      │
└──────────────────────────────┘        └────────────────────────────────┘
```

---

## Local Development

### 1. Start the backend

```bash
pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --reload --port 8000
```

### 2. Start the frontend

```bash
cd frontend
npm install
npm run dev   # opens http://localhost:5173
```

Vite proxies `/api/*` → `http://localhost:8000` automatically during dev.

---

## Deploy to Firebase + Cloud Run

### Prerequisites

```bash
npm install -g firebase-tools
# Install Google Cloud SDK: https://cloud.google.com/sdk/docs/install
```

### One-command deploy

```bash
chmod +x deploy.sh
./deploy.sh YOUR_GCP_PROJECT_ID asia-east1
```

### Manual steps

```bash
# 1. Deploy backend to Cloud Run
gcloud run deploy pdf-backend --source . --region asia-east1 --allow-unauthenticated

# 2. Build frontend with Cloud Run URL
cd frontend
VITE_API_URL=https://pdf-backend-xxxx-xx.a.run.app npm run build
cd ..

# 3. Set your Firebase project ID in .firebaserc, then deploy frontend
firebase deploy --only hosting --project YOUR_PROJECT_ID
```

---

## Features

| Feature | Description |
|---|---|
| Import PDFs | Upload PDF files from your browser |
| PDF Tree View | Collapsible file/page tree with Expand All / Collapse All |
| Extraction Boxes | Draw boxes on PDF pages to define extraction regions |
| Data Table | View/edit extracted text; sortable, filterable, custom columns |
| Single Page Data Table | Per-page quick editor with page/template navigation |
| Recognize Text | PyMuPDF vector extraction + Tesseract OCR fallback |
| Template Management | Save/apply/update extraction templates across pages |
| Google Login & Account | Firebase-authenticated login and account profile page |
| Admin Panel | User status/tier/group management + usage reset + group management |
| Save / Load | Persist project state as JSON |
| Export Excel | Download extracted data as `.xlsx` |

---

## Project Structure

```
├── backend/                 FastAPI backend
│   ├── main.py
│   ├── requirements.txt
│   └── routers/             pdf.py · project.py · export.py
├── frontend/                React + Vite frontend
│   └── src/
│       ├── App.tsx
│       ├── components/      Toolbar · PDFTreeView · DataTable · PDFViewer · StatusBar
│       ├── hooks/useProject.ts
│       ├── api/client.ts
│       └── types/index.ts
├── frontend-dist/           Built frontend (generated; not committed)
├── models/                  Shared Python data models
├── utils/                   PDF processing + Excel export utilities
├── Test/                    pytest test suite (94 tests)
├── Dockerfile               Cloud Run container
├── firebase.json            Firebase Hosting config
├── deploy.sh                One-command deploy script
└── .firebaserc              Firebase project reference
```

---

## Running Tests

```bash
QT_QPA_PLATFORM=offscreen python -m pytest -q
```

---

## Environment Variables

| Variable | Where | Description |
|---|---|---|
| `VITE_API_URL` | Frontend build | Cloud Run URL (empty = Vite proxy in dev) |
| `PORT` | Backend | Listen port (Cloud Run sets this automatically to 8080) |
