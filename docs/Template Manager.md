# Template Manager

> **Note:** This section provides a user‑focused overview of the template
> management capabilities now built into the application. The detailed design
> notes and planning diagrams have been retired.

The Template Manager is accessible via the **Templates** button in the main
toolbar or through the activity bar module. It lets users perform the
following actions:

- **Create a new template:** Draw boxes on a sample page, define column names
  and types, add optional notes, and save. The preview image is captured and
  stored automatically. Templates are given unique IDs and may be named for
  easy identification.
- **Apply templates:** Select one or more pages (using the page selector modal)
  and apply a template to them. Missing columns are auto‑injected into the
  project. Page thumbnails help confirm the correct template before application.
- **Edit & delete:** Modify existing templates or remove them. Owners may delete
  their own templates; administrators may edit or delete any template in
  Firestore.
- **Cloud synchronization:** When signed in, templates can be synced to Firestore
  with visibility settings (personal, public, group). Use the filter dropdown
  to switch between scopes.

### Usage tips

- Drag across multiple pages in the selector to quickly pick a range.
- Use the “Save New” button to duplicate a template under a new name.
- After editing a template that’s already applied, click **Update** to push
  updates to pages currently using it.

Templates integrate seamlessly with other modules; there is no separate
window as originally sketched. For step‑by‑step screenshots refer to the main
online documentation (index.html).

---

*End of Template Manager overview.*
