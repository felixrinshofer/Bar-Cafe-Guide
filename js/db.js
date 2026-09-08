const DB_NAME = "muc-bars";
const DB_VERSION = 1;
const STORE = "venues";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDb().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

export async function getAllVenues() {
  const store = await tx(STORE, "readonly");
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putVenue(venue) {
  const store = await tx(STORE, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(venue);
    req.onsuccess = () => resolve(venue);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteVenue(id) {
  const store = await tx(STORE, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function createId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `v-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
