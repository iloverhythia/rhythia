// Browser replacement for the user folder on disk (maps/, pbs/, replays/, meshes/, colorsets/)
// and the SQLite database (map cache + stats). Everything lives in one IndexedDB database.

const DB_NAME = 'rhythia';
const DB_VERSION = 1;
const STORES = ['maps', 'mapfiles', 'pbs', 'replays', 'stats', 'meshes', 'colorsets'];

let dbPromise = null;

function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            for (const name of STORES) {
                if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

function wrap(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function store(name, mode = 'readonly') {
    const db = await open();
    return db.transaction(name, mode).objectStore(name);
}

export const Storage = {
    async get(storeName, key) {
        return wrap((await store(storeName)).get(key));
    },
    async put(storeName, key, value) {
        return wrap((await store(storeName, 'readwrite')).put(value, key));
    },
    async delete(storeName, key) {
        return wrap((await store(storeName, 'readwrite')).delete(key));
    },
    async exists(storeName, key) {
        return (await wrap((await store(storeName)).count(key))) > 0;
    },
    async keys(storeName) {
        return wrap((await store(storeName)).getAllKeys());
    },
    async all(storeName) {
        const s = await store(storeName);
        const [keys, values] = await Promise.all([wrap(s.getAllKeys()), wrap(s.getAll())]);
        return keys.map((k, i) => [k, values[i]]);
    },
    async clear(storeName) {
        return wrap((await store(storeName, 'readwrite')).clear());
    },
    STORES,
};
