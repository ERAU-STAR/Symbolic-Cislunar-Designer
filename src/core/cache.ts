// Tiny IndexedDB key-value store for map checkpoints. Every call is wrapped so
// the app keeps working (without caching) where storage is unavailable.
const DB = 'csd-cache', STORE = 'maps';

function open(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch {
      res(null);
    }
  });
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((res) => {
    try {
      const q = db.transaction(STORE).objectStore(STORE).get(key);
      q.onsuccess = () => res(q.result as T);
      q.onerror = () => res(undefined);
    } catch {
      res(undefined);
    }
  });
}

export async function cachePut(key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) return;
  return new Promise((res) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
      tx.onabort = () => res(); // e.g. storage quota exceeded: carry on without caching
    } catch {
      res();
    }
  });
}

export async function cacheClear(): Promise<void> {
  const db = await open();
  if (!db) return;
  return new Promise((res) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => res();
      tx.onerror = () => res();
      tx.onabort = () => res(); // e.g. storage quota exceeded: carry on without caching
    } catch {
      res();
    }
  });
}
