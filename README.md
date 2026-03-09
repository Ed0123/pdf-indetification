# 📄 PDF Text Extraction Tool — Web App

A **browser-based application** for extracting text from PDFs. Users can upload documents, draw regions to capture text, perform OCR, and export results as Excel files.

This repository hosts a **full-stack project**:
- **Frontend**: React + Vite (TypeScript)
- **Backend**: FastAPI + PyMuPDF (with Tesseract OCR fallback)
- **Deployment**: Firebase Hosting for frontend and Google Cloud Run for backend

---

## 🚀 Quick Start

### Local development
1. **Backend**
   ```bash
   pip install -r backend/requirements.txt
   python -m uvicorn backend.main:app --reload --port 8000
   ```

2. **Frontend**
   ```bash
   cd frontend
   npm install
   npm run dev         # opens http://localhost:5173
   ```
   > Vite automatically proxies `/api/*` to `http://localhost:8000` in development.

### Running tests
```bash
QT_QPA_PLATFORM=offscreen python -m pytest -q
```

---

## ⚙️ Deployment

### Prerequisites
```bash
npm install -g firebase-tools
# and install the Google Cloud SDK:
# https://cloud.google.com/sdk/docs/install
```

### One‑command deploy
```bash
chmod +x deploy.sh
./deploy.sh YOUR_GCP_PROJECT_ID asia-east1
```

### Manual steps
1. **Backend (Cloud Run)**
   ```bash
   gcloud run deploy pdf-backend --source . \
     --region asia-east1 --allow-unauthenticated
   ```

2. **Frontend (Firebase hosting)**
   ```bash
   cd frontend
   VITE_API_URL=https://pdf-backend-xxxx-xx.a.run.app npm run build
   cd ..
   firebase deploy --only hosting --project YOUR_PROJECT_ID
   ```

---

## 🏗️ Architecture

```
┌──────────────────────────────┐        ┌────────────────────────────────┐
│  Firebase Hosting             │  HTTP  │  Google Cloud Run              │
│  React + Vite (TypeScript)   │ ──────▶│  FastAPI + PyMuPDF + Tesseract │
│  frontend/                   │        │  backend/                      │
└──────────────────────────────┘        └────────────────────────────────┘
```


---

## ✅ Key Features

* **PDF import** – drag/drop or select files in-browser
* **Tree view** – navigate document/page hierarchy
* **Extraction boxes** – draw regions to capture text
* **Data table** – edit, sort, filter, and customize columns
* **Single‑page mode** – quick edit per page with template navigation
* **Text recognition** – PyMuPDF vector extraction + Tesseract OCR fallback
* **Template management** – save and apply region templates across pages
* **Google login & account** – Firebase authentication and profile page
* **Admin panel** – manage users, tiers, groups, and usage resets
* **Excel export** – download `.xlsx` exports of extracted data

For a high-level overview of the web app features, see [docs/網站功能介紹.md](docs/%E7%B6%B2%E7%AB%99%E5%8A%9F%E8%83%BD%E4%BB%8B%E7%B4%B9.md).

> ⚠️ **Removed features**: toolbar Save/Load (automatic IndexedDB persistence) and Clear Data.

---

## 📁 Project Structure

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

## 🔧 Environment Variables

| Variable      | Usage            | Description |
|---------------|------------------|-------------|
| `VITE_API_URL`| Frontend build   | Cloud Run URL (empty = dev proxy)
| `PORT`        | Backend runtime  | Server port (Cloud Run sets to 8080)

---

## 📚 Documentation & Notes
* See **docs/** for architecture diagrams, specifications and review notes.
* Frontend output lives in `frontend-dist/` (ignored by git).

---

> 📌 *This README is maintained by the development team. Please update it as features evolve.*
