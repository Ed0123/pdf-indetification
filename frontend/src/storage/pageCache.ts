/**
 * In-memory + IndexedDB LRU cache for rendered PDF page images.
 *
 * This dramatically reduces backend renderPage calls:
 * - Memory cache for instant access within session
 * - IndexedDB for persistence across page refreshes
 * - LRU eviction when cache exceeds size limit
 *
 * Cache key: `${fileId}:${pageNum}:${zoom}`
 */

const DB_NAME = "pdf_page_cache";
const STORE_NAME = "pages";
const DB_VERSION = 1;
const MAX_MEMORY_ENTRIES = 50;   // ~50 pages in memory
const MAX_IDB_ENTRIES = 200;     // ~200 pages in IndexedDB

interface CacheEntry {
  key: string;
  image: string;    // base64
  accessedAt: number;
}

// ── In-memory LRU ──

const memoryCache = new Map<string, CacheEntry>();

function memoryGet(key: string): string | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  entry.accessedAt = Date.now();
  return entry.image;
}

function memorySet(key: string, image: string): void {
  if (memoryCache.size >= MAX_MEMORY_ENTRIES) {
    // Evict least recently accessed
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of memoryCache) {
      if (v.accessedAt < oldestTime) {
        oldestTime = v.accessedAt;
        oldest = k;
      }
    }
    if (oldest) memoryCache.delete(oldest);
  }
  memoryCache.set(key, { key, image, accessedAt: Date.now() });
}

// ── IndexedDB persistence ──

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("accessedAt", "accessedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<string | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        const entry = req.result as CacheEntry | undefined;
        resolve(entry?.image ?? null);
        // Update accessedAt in background
        if (entry) {
          try {
            const txw = db.transaction(STORE_NAME, "readwrite");
            const sw = txw.objectStore(STORE_NAME);
            sw.put({ ...entry, accessedAt: Date.now() });
          } catch { /* ignore */ }
        }
      };
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

async function idbSet(key: string, image: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    // Count entries and evict if needed
    const countReq = store.count();
    countReq.onsuccess = () => {
      if (countReq.result >= MAX_IDB_ENTRIES) {
        // Delete oldest 20%
        const idx = store.index("accessedAt");
        const deleteCount = Math.ceil(MAX_IDB_ENTRIES * 0.2);
        let deleted = 0;
        const cursor = idx.openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (c && deleted < deleteCount) {
            c.delete();
            deleted++;
            c.continue();
          }
        };
      }
    };

    store.put({ key, image, accessedAt: Date.now() });
    tx.oncomplete = () => db.close();
  } catch {
    // Silently fail — cache is optional
  }
}

// ── Public API ──

export function makeCacheKey(fileId: string, pageNum: number, zoom: number): string {
  return `${fileId}:${pageNum}:${zoom}`;
}

/**
 * Get a cached page image. Checks memory first, then IndexedDB.
 */
export async function getCachedPage(fileId: string, pageNum: number, zoom: number): Promise<string | null> {
  const key = makeCacheKey(fileId, pageNum, zoom);

  // 1. Memory
  const mem = memoryGet(key);
  if (mem) return mem;

  // 2. IndexedDB
  const idb = await idbGet(key);
  if (idb) {
    memorySet(key, idb); // Promote to memory
    return idb;
  }

  return null;
}

/**
 * Store a page image in both memory and IndexedDB cache.
 */
export async function setCachedPage(fileId: string, pageNum: number, zoom: number, image: string): Promise<void> {
  const key = makeCacheKey(fileId, pageNum, zoom);
  memorySet(key, image);
  await idbSet(key, image);
}

/**
 * Invalidate all cached pages for a file (e.g., when file is re-uploaded).
 */
export function invalidateFile(fileId: string): void {
  for (const [key] of memoryCache) {
    if (key.startsWith(`${fileId}:`)) {
      memoryCache.delete(key);
    }
  }
  // IDB cleanup in background
  openDB().then((db) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (c) {
        if ((c.key as string).startsWith(`${fileId}:`)) {
          c.delete();
        }
        c.continue();
      }
    };
    tx.oncomplete = () => db.close();
  }).catch(() => {});
}

/**
 * Clear entire page cache.
 */
export async function clearPageCache(): Promise<void> {
  memoryCache.clear();
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => db.close();
  } catch { /* ignore */ }
}
