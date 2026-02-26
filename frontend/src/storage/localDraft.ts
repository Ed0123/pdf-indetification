/**
 * IndexedDB-based autosave / restore for project drafts.
 *
 * Stores the full project state (minus heavy PDF bytes which stay on the
 * server) so that a page refresh doesn't lose work.
 *
 * Storage layout (IndexedDB):
 *   DB name : "pdf_id_drafts"
 *   Store   : "drafts"
 *   Key     : user UID (one draft per user)
 *   Value   : { uid, payload, savedAt }
 */

const DB_NAME = "pdf_id_drafts";
const STORE_NAME = "drafts";
const DB_VERSION = 1;

export interface DraftPayload {
  pdf_files: any[];
  columns: any[];
  templates: any[];
  last_selected_file: string;
  last_selected_page: number;
}

interface DraftRecord {
  uid: string;
  payload: DraftPayload;
  savedAt: number; // epoch ms
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "uid" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Save a project draft to IndexedDB.
 */
export async function saveDraft(uid: string, payload: DraftPayload): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const record: DraftRecord = { uid, payload, savedAt: Date.now() };
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Load a project draft from IndexedDB.
 * Returns null if no draft exists for the given user.
 */
export async function loadDraft(uid: string): Promise<{ payload: DraftPayload; savedAt: Date } | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(uid);
    req.onsuccess = () => {
      const record = req.result as DraftRecord | undefined;
      if (record) {
        resolve({ payload: record.payload, savedAt: new Date(record.savedAt) });
      } else {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Delete the draft for a user.
 */
export async function clearDraft(uid: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(uid);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}
