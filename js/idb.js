// Kho khóa–giá trị tối giản trên IndexedDB (bộ nhớ của trình duyệt trên máy này).
const DB = 'chi-tieu-gia-dinh';
const STORE = 'kv';
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const get = (k) => run('readonly', (s) => s.get(k));
export const set = (k, v) => run('readwrite', (s) => s.put(v, k));
export const del = (k) => run('readwrite', (s) => s.delete(k));
