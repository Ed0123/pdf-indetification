# Architecture & Feature Documentation

> Last updated after Phase 9 (Cloud Storage Upgrade, UI Cleanup & Template Sync).

---

## 1  High-Level Architecture

```
┌──────────────────────────┐        ┌──────────────────────────────┐
│  Frontend (React + Vite) │  HTTP  │  Backend (FastAPI + Python)  │
│  Firebase Hosting        │ ◄────► │  Cloud Run (Docker)          │
└──────────────────────────┘        └──────────────────────────────┘
         │                                      │
         │   Firebase Auth (Google)             │   Firebase Admin SDK
         │   Firestore JS SDK                   │   Firestore (users, templates)
         ▼                                      ▼
      ┌─────────────────────────────────────────────┐
      │          Firebase / Google Cloud             │
      │  ─ Authentication  ─ Firestore  ─ Storage   │
      └─────────────────────────────────────────────┘
```

### Frontend
- **React 18** + **TypeScript 5.6** + **Vite 6**
- Firebase JS SDK for auth (`signInWithPopup`) and Firestore
- Pure inline-CSS styles (no external CSS framework)
- Deployed via `firebase deploy --only hosting`

### Backend
- **FastAPI** + **uvicorn**
- PyMuPDF (fitz), pytesseract, openpyxl, Pillow for PDF/OCR/export
- **firebase-admin** for Firestore & token verification
- Containerised with Docker → deployed to Cloud Run

---

## 2  Authentication & User Management

### 2.1 Login Flow
1. User opens the app → `LoginPage` shown.
2. Click "Login with Google" → Firebase `signInWithPopup` (Google provider).
3. Frontend stores the Firebase ID token via `setAuthToken()`.
4. Every API call includes `Authorization: Bearer <token>`.
5. Backend middleware (`auth_middleware.py`) verifies token with `firebase-admin`.

### 2.2 User Profile (`/api/users/me`)
- On first login, a Firestore document is created under `users/{uid}` with status `"pending"`.
- User is redirected to **MyAccountPage** to fill out required fields:
  - 姓名 (display_name)*
  - 稱為 (salutation)*
  - 電郵 (email)*
  - WhatsApp*
- `"pending"` and `"suspended"` users are locked to the MyAccount page.
- Only `"active"` users can access the main app.

### 2.3 Membership Tiers

| Tier      | Monthly OCR Pages | Label              |
|-----------|------------------:|---------------------|
| basic     |              100  | 基本會員            |
| sponsor   |              300  | 贊助會員            |
| premium   |              500  | 高級會員            |
| admin     |         Unlimited | 管理員              |

### 2.4 Groups
- Default group: `"個人"`.
- Admin can assign: `A組`, `B組`, `C組`.
- Group-level template sharing is supported.

### 2.5 Admin Panel (`/api/users/`)
- Only `admin`-tier users can access.
- Table with: name, email, WhatsApp, usage, **雲端用量 (cloud storage)**, tier, group, join date, last login, status, notes.
- Cloud storage shows `storage_used_bytes` formatted as KB/MB.
- Filter by name/email/phone.
- Inline editing of: status, tier, group, notes.

---

## 3  Frontend UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Toolbar  〔Import〕〔☁ 雲端儲存〕…             〔👤 My Account〕 │
├──────┬──────────────────────────────┬───────────────────────┤
│      │  ▲ Data Table (collapsible)  │                       │
│  ◀   │  ┌───┬────┬────┬───────┐    │     PDF Viewer        │
│  PDF │  │...│... │... │...    │    │     (zoom, pan, draw) │
│ Tree │  └───┴────┴────┴───────┘    │                       │
│      │  ─────────────────────────  │                       │
│      │  SinglePageDataTable        │                       │
│      │  〔Page ▼〕〔◀ Prev〕〔Next ▶〕│                       │
│      │  〔Template ▼〕〔💾 Update〕   │                       │
│      │  Column │ Text              │                       │
│      │  ───────┼──────             │                       │
│      │  Title  │ ...               │                       │
│      │  Page   │ ...               │                       │
├──────┴──────────────────────────────┴───────────────────────┤
│  StatusBar: Ready  │ Files: 3  Pages: 12  │ OCR: 5/100 │OCR│
└─────────────────────────────────────────────────────────────┘
```

### Collapsible Panels
- **PDF Tree (left):** Toggle button collapses to a 28px-wide strip.
- **Data Table (top of column 2):** Toggle button collapses, leaving SinglePageDataTable full-height.

### SinglePageDataTable
- Below the main DataTable (always visible).
- Page dropdown + Previous/Next navigation.
- Template dropdown + **Save New** / **Update** buttons.
- **Update** auto-applies changed template to all pages using it.
- Recognize button for single-page OCR.

---

## 4  Template System

### 4.1 Local Templates
- Stored in project JSON (autosaved to IndexedDB).
- Managed via TemplateModal (toolbar → Templates).
- Each template has: `id`, `name`, `boxes[]`, `notes`, `preview_file_id`, `preview_page`, optional `owner_uid`, `owner_name`.
- Apply to specific pages (multi-select via PageSelectorModal).
- **Template apply now auto-syncs columns:** when a template is applied, any columns defined in the template but missing from the project are automatically added via `project.addColumn()`.

### 4.2 Cloud Templates (Firestore)
- Backend routes: `GET/POST/PUT/DELETE /api/templates/`.
- Storage: Firestore collection `templates`.
- Each document has: `owner_uid`, `name`, `boxes`, `permission`, `preview_image` (base64), `group`.
- **Permission levels:**
  - `personal` — only owner can see.
  - `public` — all users can see.
  - `group` — all users in the same group can see.
- Admins can see and edit all templates.

### 4.3 Template Manager UI
- Columns: **ID**, **Name**, **Columns**, **Notes**, **Owner**.
- Owner shows "我" for own templates, "他人" for others.
- **Filter input** at top — filters by name, column names, notes, owner, and ID.
- `currentUserUid` prop passed from App for ownership display.

---

## 5  Usage Tracking

- Each OCR operation records page count via `POST /api/users/usage/record`.
- Monthly counters reset automatically.
- StatusBar displays: `OCR: {used}/{limit}`.
- Over-limit users are warned before OCR starts.

---

## 5.1  Text / OCR Extraction Pipeline

Text extraction follows a two-stage fallback approach per region:

1. **Vector text** — `page.get_text("text", clip=rect)` extracts embedded text.
   If found, returned immediately (fast, accurate).
2. **OCR fallback** (`_ocr_region`) — only when vector text is empty.

### `_ocr_region` implementation details
| Step | Description |
|------|-------------|
| Clamp | `rect` is clamped to page boundaries; empty rects return `""` |
| Render | `page.get_pixmap(matrix=3×, clip=clamped_rect)` — **only** the region at 300 DPI |
| Primary OCR | `pytesseract.image_to_string(image, config="--psm 6")` — **PSM 6** (single block) |
| Fallback OCR | PyMuPDF `get_textpage_ocr()` on a **cropped-image mini-doc**, not the full page |

### Previous bugs (fixed Phase 8)
| Bug | Root cause | Fix |
|-----|-----------|-----|
| Tesseract PSM 3 | `image_to_string()` called without config → default PSM 3 (full-page segmentation) | Explicitly pass `--psm 6` (single uniform block) |
| Full-page OCR coordinates | `get_textpage_ocr(full=False)` was called on the **original page** (no clip param available), then text filtered by `clip=rect` — OCR processed the entire page | Render only the clipped region as a pixmap, open it as a standalone mini-document, then run `get_textpage_ocr` on that |

---

## 6  API Endpoints

### Health & OCR
| Method | Path             | Auth | Description              |
|--------|------------------|------|--------------------------|
| GET    | `/api/health`    | No   | Liveness probe           |
| GET    | `/api/ocr/status`| No   | Tesseract availability   |

### PDF
| Method | Path                                | Auth | Description       |
|--------|-------------------------------------|------|-------------------|
| POST   | `/api/pdf/upload`                   | Yes  | Upload PDFs       |
| GET    | `/api/pdf/{id}/page/{n}/render`     | Yes  | Render page image |
| POST   | `/api/pdf/{id}/page/{n}/extract`    | Yes  | Extract text      |
| POST   | `/api/pdf/export-pages`             | Yes  | Export pages ZIP  |

### Project
| Method | Path               | Auth | Description        |
|--------|--------------------|------|--------------------|
| POST   | `/api/project/save`| Yes  | Download JSON      |
| POST   | `/api/project/load`| Yes  | Upload & parse JSON|

### Export
| Method | Path              | Auth | Description      |
|--------|-------------------|------|------------------|
| POST   | `/api/export/excel`| Yes | Export XLSX       |

### Users
| Method | Path                     | Auth  | Description            |
|--------|--------------------------|-------|------------------------|
| GET    | `/api/users/me`          | User  | Get own profile        |
| PUT    | `/api/users/me`          | User  | Update own profile     |
| GET    | `/api/users/`            | Admin | List all users         |
| PUT    | `/api/users/{uid}`       | Admin | Update any user        |
| POST   | `/api/users/usage/record`| User  | Record OCR usage       |

### Templates (Cloud)
| Method | Path                       | Auth  | Description          |
|--------|----------------------------|-------|----------------------|
| GET    | `/api/templates/`          | User  | List visible templates|
| POST   | `/api/templates/`          | User  | Create template      |
| PUT    | `/api/templates/{id}`      | Owner/Admin | Update template|
| DELETE | `/api/templates/{id}`      | Owner/Admin | Delete template|

### Cloud Projects
| Method | Path                                              | Auth  | Description                         |
|--------|---------------------------------------------------|-------|-------------------------------------|
| GET    | `/api/projects/cloud/`                            | User  | List user's cloud projects          |
| POST   | `/api/projects/cloud/`                            | User  | Create cloud project metadata       |
| PUT    | `/api/projects/cloud/{id}`                        | Owner | Update project name/permanent flag  |
| DELETE | `/api/projects/cloud/{id}`                        | Owner | Delete project + storage blobs      |
| POST   | `/api/projects/cloud/{id}/upload-full`            | Owner | Upload JSON + all PDFs to Storage   |
| GET    | `/api/projects/cloud/{id}/load-full`              | Owner | Download JSON + restore PDFs to _STORE |

---

## 6.5  Cloud Project Storage

### Storage Architecture
- **Firebase Cloud Storage** bucket: `pdf-text-extraction-488009.firebasestorage.app`
- Path pattern: `cloud_projects/{uid}/{project_id}/project.json` + `cloud_projects/{uid}/{project_id}/{file_id}.pdf`
- Backend `_STORE` dict in `pdf.py` holds in-memory mapping of `file_id → temp disk path`
- `cloud_projects.py` imports `_STORE` from `pdf.py` for upload-full/load-full operations

### Save Flow (upload-full)
1. Frontend sends project JSON via `POST /api/projects/cloud/{id}/upload-full`
2. Backend reads each PDF file from `_STORE` by `file_id`
3. Backend uploads `project.json` + each `{file_id}.pdf` to Cloud Storage
4. Metadata updated in Firestore with `pdf_paths[]`, `size_bytes`, `expires_at`
5. Storage quota enforced per user tier

### Load Flow (load-full)
1. Frontend calls `GET /api/projects/cloud/{id}/load-full`
2. Backend downloads `project.json` from Cloud Storage
3. Backend downloads each PDF from Cloud Storage → temp dir → registers in `_STORE` with new `file_id`
4. Backend remaps all `file_id` references in the project JSON
5. Returns remapped JSON (+ `_warnings` list for any missing PDFs)
6. Non-permanent projects get TTL extended on load

### Toolbar Changes (Phase 9)
- **Removed:** Save (💾) and Load (📁) buttons
- **Default persistence:** IndexedDB autosave (local, automatic)
- **Cloud button:** "☁ 雲端儲存" — opens CloudProjectsPanel for full JSON+PDF cloud management

### TTL & Permanent Storage
- New projects default to `permanent: false` with `expires_at: now + 14 days`
- Each update/load resets the 14-day TTL
- Users can toggle permanent via lock/unlock button in CloudProjectsPanel
- Permanent projects have `expires_at: ""` (no expiry)
- CloudProjectsPanel shows expiry status: "♾ 永久保存", "⚠ X 天後刪除", etc.

---

## 7  File Structure

```
backend/
  main.py                    # FastAPI app, router registration, Firebase init
  firebase_setup.py          # Firebase Admin SDK init, Firestore client, token verify
  auth_middleware.py          # require_auth dependency (Bearer token validation)
  requirements.txt           # Python dependencies
  routers/
    pdf.py                   # PDF upload, render, extract (_STORE dict)
    project.py               # Project save/load
    export.py                # Excel export
    pdf_export.py            # PDF page export (ZIP)
    users.py                 # User profile, admin, usage tracking
    templates.py             # Cloud template CRUD
    cloud_projects.py        # Cloud project CRUD, upload-full, load-full, TTL

frontend/
  src/
    App.tsx                  # Root component — auth routing, layout, all handlers
    firebase.ts              # Firebase JS SDK init (auth, Firestore, Google provider)
    api/client.ts            # HTTP wrappers (auto-injects auth token)
    types/index.ts           # Core types (BoxInfo, PageData, Template, etc.)
    types/user.ts            # UserProfile, MemberTier, AccountStatus, limits
    hooks/
      useAuth.ts             # Firebase auth state + signIn/signOut/getToken
      useProject.ts          # useReducer state management (PDF files, columns, etc.)
    storage/
      indexedDB.ts           # IndexedDB autosave (local persistence)
    components/
      LoginPage.tsx          # Google sign-in page
      MyAccountPage.tsx      # Profile editing, usage stats, membership info
      AdminPanel.tsx         # User management table + cloud storage column (admin only)
      Toolbar.tsx            # Top toolbar (Import, Cloud, Templates, etc.)
      PDFTreeView.tsx        # Left panel — PDF file/page tree
      DataTable.tsx          # Multi-file extraction data table
      SinglePageDataTable.tsx# Per-page data view, page/template dropdowns
      PDFViewer.tsx          # PDF page renderer with box drawing
      StatusBar.tsx          # Bottom status bar with usage info
      TemplateModal.tsx      # Template manager (ID/Name/Columns/Notes/Owner + filter)
      CloudProjectsPanel.tsx # Cloud project panel (JSON+PDF upload/load, TTL, permanent)
      PDFExportModal.tsx     # PDF page export (naming, ZIP download)
      PageSelectorModal.tsx  # Multi-page selector dialog
      ConfirmDialog.tsx      # Generic confirmation dialog
```

---

## 8  Deployment

### Firebase Hosting (Frontend)
```bash
cd frontend && npm run build
firebase deploy --only hosting
```

### Cloud Run (Backend)
```bash
gcloud run deploy pdf-backend \
  --source backend/ \
  --region asia-east1 \
  --set-env-vars GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
```

### Environment Variables

| Variable                          | Where    | Purpose                        |
|-----------------------------------|----------|--------------------------------|
| `VITE_FIREBASE_API_KEY`           | Frontend | Firebase project API key       |
| `VITE_FIREBASE_AUTH_DOMAIN`       | Frontend | Firebase auth domain           |
| `VITE_FIREBASE_PROJECT_ID`        | Frontend | Firebase project ID            |
| `VITE_FIREBASE_STORAGE_BUCKET`    | Frontend | Firebase storage bucket        |
| `VITE_FIREBASE_MESSAGING_SENDER_ID`| Frontend| Firebase messaging sender ID  |
| `VITE_FIREBASE_APP_ID`           | Frontend | Firebase app ID                |
| `VITE_API_URL`                   | Frontend | Backend URL (Cloud Run)        |
| `GOOGLE_APPLICATION_CREDENTIALS` | Backend  | Path to service account JSON   |

---

## 9  Testing

```bash
# Backend unit tests (68 non-UI)
python -m pytest Test/ -v --ignore=Test/test_ui_components.py

# Frontend type check
cd frontend && npx tsc --noEmit

# Frontend production build
cd frontend && npm run build
```

---

## 10  Changelog

### Phase 9 — Cloud Storage Upgrade, UI Cleanup & Template Sync
1. **Toolbar:** Removed Save/Load buttons; renamed Cloud button to "☁ 雲端儲存"
2. **Local persistence:** IndexedDB autosave remains as default (no changes needed)
3. **Cloud upgrade (JSON + PDF):** New `upload-full` and `load-full` backend endpoints; PDFs now uploaded alongside project JSON to Firebase Cloud Storage; load restores PDFs to server `_STORE` with remapped file_ids
4. **Admin panel — cloud storage column:** Added "雲端用量" column showing each user's `storage_used_bytes` formatted as KB/MB
5. **Template Manager UI:** Columns changed to ID / Name / Columns / Notes / Owner; added filter input (searches name, columns, notes, owner, ID); `currentUserUid` prop for ownership display
6. **Template apply — column sync:** Both `handleTemplateApply` (multi-page) and `handleSingleApplyTemplate` (single-page) now auto-add missing columns from the template via `project.addColumn()` before applying boxes
7. **Cloud project TTL & permanent:** Projects default to 14-day TTL from last update; load extends TTL; permanent toggle (lock/unlock) in CloudProjectsPanel; expiry displayed with color-coded status
