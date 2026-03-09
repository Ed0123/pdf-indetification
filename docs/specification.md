# Specification – Web-Based PDF Extraction System

> **Note (2026-03-07):** Documentation reviewed and streamlined. Outdated authentication options (email/password) removed and audit log feature references deleted – these are not implemented.


## High‑Level Objective 🎯
Build a cloud‑hosted application that allows users to upload PDF documents, define extraction templates, and automatically retrieve structured data into BigQuery or Excel.  The goal is to replace the legacy desktop PyQt5 tool with a responsive SPA frontend, a scalable REST/HTTP API backend, and optional OCR support for scanned documents.

---

## Architecture 🏗️

- **Frontend** – TypeScript/React application (in `frontend/`) built with Vite; communicates with the backend via a `client.ts` API wrapper.
- **Backend** – Python FastAPI service (in `backend/`) deployed in Docker, using Firebase for authentication and Firestore/BigQuery for data storage.
- **Storage** – PDF files temporarily stored in Cloud Storage; extraction templates and user metadata in Firestore.
- **OCR & Extraction** – Templates drive region‑based extraction. Text layers are read via PyMuPDF; if blank, an OCR microservice (Tesseract/BigQuery OCR) is invoked.
- **Deployment** – Containerized service orchestrated with `deploy.sh` and `Dockerfile`; frontend served via Firebase Hosting.

![High-level architecture](https://dummy.url/architecture-diagram)

---

## UI Design Summary 🖥️

- **Login / My Account** – Firebase‑authenticated entry point with user settings.
- **Activity Bar** – Side menu for navigation: Projects, Templates, Exports, Admin (if authorized).
- **Main Workspace** – Three panels:
  1. **Project/Cloud‑Project List** – Tree view of projects and associated PDFs.
  2. **Data Table** – Shows extracted data rows; columns are template fields, sortable/filterable.
  3. **PDF Viewer** – Displays pages, allows drawing region boxes, zoom/pan, and highlights corresponding table cells.
- **Modals & Panels** – Template manager, PDF import, export selectors, confirm dialogs and status bar.
- **Responsive & Accessible** – Keyboard shortcuts, aria tags, dark/light theme support.

---

## Feature List ✅

1. **User Authentication** – Firebase Google OAuth only.
2. **PDF Import** – Upload individual files or directories; preview upon upload.
3. **Template Definition** – Create fields with names, types and region boxes; save per project.
4. **Automatic Extraction** – Batch process PDFs using selected template; fallback to OCR.
5. **Manual Adjustment** – Draw/modify boxes in viewer; edit table cells inline.
6. **BigQuery Integration** – Export extracted rows to a specified BQ dataset.
7. **Excel Export** – Download results as `.xlsx` with fixed sheet layout.
8. **Admin Messages** – Send broadcast notices to users via UI panel.
9. **OCR Availability Indicator** – Shows whether OCR service is reachable.

---

## Backend APIs 📡

All endpoints live under `/api/v1` and require a valid Firebase JWT.

- **`POST /login`** – Firebase token exchange.
- **`GET /projects`** – List user projects.
- **`POST /projects`** – Create new project.
- **`POST /projects/{id}/upload`** – Upload PDF(s).
- **`GET /templates`** – Retrieve templates.
- **`POST /templates`** – Save template definition.
- **`POST /extract`** – Trigger extraction job; returns job ID.
- **`GET /extract/{jobId}`** – Check status/results.
- **`POST /export/bq`** – Export job results to BigQuery.
- **`GET /export/excel/{jobId}`** – Download Excel file.
- **`GET /admin/messages`** / **`POST /admin/messages`** – Read/send admin notices.

Swagger/OpenAPI documentation is automatically generated from FastAPI models (`backend/routers/*.py`).

---

## Authentication 🔐

- Managed by Firebase Authentication.
- Frontend obtains ID token on login; backend verifies using Firebase Admin SDK (`backend/firebase_setup.py`).
- Authorization middleware (`auth_middleware.py`) injects `current_user` into request context.
- Role‑based access for admin routes.

---

## Templates 📄

- Stored in Firestore with fields: `name`, `projectId`, `fields` (each has `label`, `type`, `coordinates`).
- Coordinates normalized to page dimensions.
- Templates can be edited in the UI; changes versioned.
- Extraction engine loads template, iterates pages, reads regions, and writes values to a result document.

---

## BigQuery & OCR Integration ☁️

- **BigQuery** – `bq.py` and `bq_templates.py` handle schema creation and row insertion.
- **OCR** – Primary text extraction via PyMuPDF. If page has no text, service sends the page image to:
  - Local Tesseract daemon (`utils/pdf_processing.py`), or
  - Google Cloud Vision / BigQuery OCR via configured credentials.
- Extraction jobs run asynchronously and update Firestore job documents with progress.

---

## Testing 🧪

- Pytest suite under `Test/` covers backend logic:
  - `test_bq_templates_api.py`, `test_pdf_processing.py`, `test_users_api.py`, etc.
- Frontend tests (`test_ui_components.tsx`) use Jest/React Testing Library.
- CI pipeline (GitHub Actions) runs linting, unit tests, and builds on pull requests.
- Mock Firebase and BigQuery APIs for offline tests (`conftest.py`).

---

## Documentation 📚

- Markdown source in `docs/` compiled to HTML.
- Sections include:
  - **Introduction** – Project overview and use cases.
  - **Architecture** – Diagrams and description.
  - **Installation** – Local development & container setup.
  - **User Guide** – Walkthrough of UI features.
  - **Developer Guide** – Code structure, key modules, and contributing.
  - **API Reference** – Auto‑generated from FastAPI models.
  - **Template Format** – JSON schema and coordinate conventions.
  - **Testing** – How to run and extend tests.
  - **Troubleshooting** – Common issues and resolutions.

Docs are served via `frontend-dist/index.html` in production and updated during CI.

---

## Deployment 🚀

1. **Build** – Run `npm run build` in `frontend`; Python image built via `Dockerfile`.
2. **Push** – Container pushed to registry; frontend deployed to Firebase Hosting.
3. **Configure** – Environment variables for Firebase credentials, BQ dataset, OCR endpoint.
4. **Scripts** – `deploy.sh` orchestrates build, push, and Firebase deploy.
5. **Monitoring** – Application logs captured by Stackdriver; uptime checks configured.

---

This specification supersedes all previous desktop‑oriented documents and reflects the current state of the web‑based PDF extraction platform.

