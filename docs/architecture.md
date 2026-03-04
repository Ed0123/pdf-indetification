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
### 2.2.1 Session & Draft Management
- Frontend installs a callback so that when **any API request** returns 401 even
  after forcing a token refresh the app immediately shows a toast and redirects
  to the login page.  This prevents the UI from becoming unresponsive after the
  Firebase token expires.
- A periodic keep‑alive ping (`recordUsage(0)`) runs every 30 minutes while the
  user is logged in; it touches the Firebase SDK to ensure tokens are kept
  fresh even if the tab is backgrounded or browser timers are throttled.
- After 6 hours of no mouse/keyboard/touch activity the client automatically
  signs the user out for security.  State is preserved in IndexedDB before the
  logout, so the user can restore their project on next login.
- Draft payloads now optionally include the original PDF `File` objects.  When
  a draft is restored the user is warned and, if necessary, any missing
  server‑side temporary files are transparently re‑uploaded using the cached
  blobs.  This makes recovery from container restarts or cache evictions much
  smoother.
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
- **User messaging:** new "✉ 訊息" tab displays all messages sent via `/api/messages/`. Admins can reply inline; replies update the Firestore doc and trigger an email back to the user.
  - Users are informed in the UI that their message will be automatically removed after 7 days, and admins receive the same reminder in the notification email.

---

## 3  Frontend UI Layout

The left-hand **ActivityBar** displays navigation modules in a grouped order:
**Templates** first, then the core tools (Page View / Excel Export / PDF Export),
and finally the BQ features. Vertical separators appear between these groups.


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
- Templates now display a thumbnail of the preview page; page templates upload an image to Cloud Storage and BQ templates follow the same mechanism so the preview is visible even when the source PDF isn't loaded.

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

## 5.2  BQ-OCR (Bill of Quantities Extraction)

### Overview
BQ-OCR extracts structured table data from PDF Bill of Quantities documents using pdfplumber. It handles multi-column layouts with intelligent row merging.

### Feature Access by Tier
| Tier    | `bq_ocr` | `bq_export` | Quota          |
|---------|:--------:|:-----------:|----------------|
| basic   | ❌       | ❌          | 100 pages/mo   |
| sponsor | ✅       | ✅          | 300 pages/mo   |
| premium | ✅       | ✅          | 500 pages/mo   |
| admin   | ✅       | ✅          | Unlimited      |

### Batch Extraction UI Enhancements
- Users may now supply a page-range string (e.g. `1-100`, `5,10-20,25-80`) when
  performing a BQ‑OCR batch; the panel accepts the input beside the batch
  button and will parse it automatically.
- The page selector dialog includes the same range field, plus a live count
  and visual feedback when the selection would exceed the per‑batch
  200‑page limit or the user's remaining OCR quota.  The dialog also shows
  current usage and remaining quota so operators can make informed choices.
- While a batch extraction is running the entire BQ‑OCR panel is covered by a
  translucent overlay with a progress bar; all controls are disabled until
  processing completes.

### Extraction Pipeline
| Step | Description |
|------|-------------|
| 1. Zone Detection | User defines boxes for: `DataRange`, `PageNo`, `Revision`, `BillName`, `Collection` |
| 2. Column Headers | User defines boxes for columns: `Item`, `Description`, `Qty`, `Unit`, `Rate`, `Total` |
| 3. Text Extraction | `pdfplumber` extracts all text with coordinates inside DataRange |
| 4. Column Assignment | Each text block assigned to column based on X-coordinate overlap with header boxes |
| 5. Line Grouping | Text blocks grouped into lines by Y-coordinate (threshold: median line height) |
| 6. Row Merging | Consecutive lines merged if Y-distance < 1.5× median line height |
| 7. Type Classification | Rows classified as: `heading1`, `heading2`, `item`, `notes` based on column population |

### Row Type Classification Logic
| Type | Condition |
|------|-----------|
| `heading1` | Only Description column has text (spans full width) |
| `heading2` | 2+ columns have text but no Qty/Rate/Total values |
| `item` | Item column OR Qty/Rate/Total has numeric value |
| `notes` | All other rows (typically footnotes, continuation text) |

### Response Schema (`BQRowResponse`)
| Field | Type | Description |
|-------|------|-------------|
| `id` | int | Unique ID: `(page_num + 1) * 10000 + row_id` |
| `page_number` | int | 0-indexed PDF page number |
| `page_label` | str | Zone-defined label (e.g., "B/1/2") |
| `revision` | str | Zone-defined revision text |
| `type` | str | `heading1` \| `heading2` \| `item` \| `notes` |
| `item_no` | str | Extracted Item column text |
| `description` | str | Merged Description text |
| `quantity` | float? | Parsed Qty value |
| `unit` | str | Unit text |
| `rate` | float? | Parsed Rate value |
| `total` | float? | Parsed Total value |
| `bbox` | dict? | `{x0, y0, x1, y1}` coordinates for UI highlighting |

### Quota Integration
- BQ extraction counts against the same `usage_pages` as regular OCR
- Quota cost: 1 page per page processed (pdfplumber)
- Returns HTTP 429 when quota exceeded
- **Admin API fix:** listing users now performs a monthly reset on each
  profile so the admin panel always reflects the current month's usage even
  if the user has not yet triggered an OCR operation.

### Export Filters
| Filter | Options |
|--------|---------|
| Page   | All pages / specific page label |
| Revision | All revisions / specific revision |
| Type   | All / Items / Notes / Heading1 / Heading2 |

### API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/bq/engines` | Yes | List available BQ engines |
| POST | `/api/bq/extract` | Yes | Extract BQ data from pages |

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
| POST   | `/api/users/message`     | User | Send a message to admin |
| GET    | `/api/users/message`     | User | List own messages      |

### Messages (Admin-only)
| Method | Path                       | Description |
|--------|----------------------------|-------------|
| GET    | `/api/messages/`           | List all user messages (admin) |
| PUT    | `/api/messages/{id}/reply` | Reply to a message (admin) |

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

### Toolbar & UI adjustments (Phase 10)
- **Toolbar slimmed:** only Import and Cloud actions remain; export/recognize/template/pdf-export buttons moved into the data table area
- **Clear Data:** removed entirely (no longer used)
- **Delete File:** button relocated into PDF tree view header for contextual operations

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
    messages.py              # User-admin messaging (send/reply), Firestore sync

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
      AdminMessagesPanel.tsx # Admin messaging UI (send/reply to users)
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
| `GMAIL_USER`                     | Backend  | Gmail sender address           |
| `GMAIL_APP_PASSWORD`             | Backend  | Gmail App Password (16-char)   |
| `ADMIN_NOTIFY_EMAIL`             | Backend  | Admin notification recipient   |

*Deployment script:* `deploy.sh` now reads `GMAIL_USER`, `GMAIL_APP_PASSWORD` and optional `ADMIN_NOTIFY_EMAIL` from the shell environment, passes them to `gcloud run deploy` and then reapplies them with `gcloud run services update` to guarantee they persist across revisions.  **The script will now early‑abort with an error if `GMAIL_USER` or `GMAIL_APP_PASSWORD` are not provided**, which forces any automated agent to supply them before running.
---

*Note:* the Gmail-related environment variables (`GMAIL_USER`, `GMAIL_APP_PASSWORD`, `ADMIN_NOTIFY_EMAIL`) must be set on the Cloud Run **service configuration** (via `gcloud run services update --update-env-vars` or the Cloud Console). These values do **not** automatically carry forward when a new revision is built from source; starting without them results in disabled email notifications and a warning logged at startup.

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
