/**
 * localStorage-based cache with TTL for API responses.
 *
 * Reduces backend reads for data that changes infrequently:
 * - Templates (TTL: 10 min)
 * - System updates (TTL: 5 min)
 * - OCR status (TTL: 30 min)
 * - Profile (TTL: 5 min)
 */

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  version: number;
}

const CACHE_VERSION = 1;

export function getCached<T>(key: string, ttlMs: number): T | null {
  try {
    const raw = localStorage.getItem(`cache:${key}`);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (entry.version !== CACHE_VERSION) return null;
    if (Date.now() - entry.cachedAt > ttlMs) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export function setCache<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, cachedAt: Date.now(), version: CACHE_VERSION };
    localStorage.setItem(`cache:${key}`, JSON.stringify(entry));
  } catch {
    // localStorage full — silently skip
  }
}

export function invalidateCache(key: string): void {
  try {
    localStorage.removeItem(`cache:${key}`);
  } catch { /* ignore */ }
}

export function invalidateCachePrefix(prefix: string): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(`cache:${prefix}`)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

// Predefined TTLs (milliseconds)
export const TTL = {
  TEMPLATES: 10 * 60 * 1000,       // 10 min
  BQ_TEMPLATES: 10 * 60 * 1000,    // 10 min
  SYSTEM_UPDATES: 5 * 60 * 1000,   // 5 min
  OCR_STATUS: 30 * 60 * 1000,      // 30 min
  PROFILE: 5 * 60 * 1000,          // 5 min
  WORKSPACE_STARTUP: 2 * 60 * 1000, // 2 min
} as const;
