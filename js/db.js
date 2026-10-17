// 保存（IndexedDB）。iPhone の中だけに置き、どこにも送らない
//
// kv     … library / playlists / settings（どれも formatVersion 付きの JSON。Android 版と同じ形）
// files  … "曲ID/ファイル名" → Blob（曲のファイル media.*、ジャケット cover.jpg）
// lyrics … 曲ID → LRC の文字列
//
// 保存データの形式のルール（Android 版と同じ）
// - JSON には必ず formatVersion を付ける
// - 形式を変えるときは版を上げ、MIGRATIONS に「古い版 → 新しい版」の変換を足す（古い変換は消さない）
// - 変換の前に、元の JSON を kv の "backup:<名前>:<日時>" に控える

const DB_NAME = 'otokura';
const DB_VERSION = 1;

export const FORMATS = {
  library: { current: 2, migrations: {} },
  playlists: { current: 2, migrations: {} },
  settings: { current: 1, migrations: {} },
  // よく使うサイト（iPhone 版だけ）
  bookmarks: { current: 1, migrations: {} },
};

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      if (!db.objectStoreNames.contains('lyrics')) db.createObjectStore('lyrics');
    };
    req.onsuccess = () => {
      const db = req.result;
      // 別のタブで版が上がったら閉じる（次の操作で開き直す）
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
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

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let result;
    Promise.resolve(fn(t.objectStore(store)))
      .then((r) => {
        result = r;
      })
      .catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('保存が中断されました'));
  });
}

export const kv = {
  get: (key) => tx('kv', 'readonly', (s) => wrap(s.get(key))),
  set: (key, value) => tx('kv', 'readwrite', (s) => wrap(s.put(value, key))),
  del: (key) => tx('kv', 'readwrite', (s) => wrap(s.delete(key))),
  keys: () => tx('kv', 'readonly', (s) => wrap(s.getAllKeys())),
};

export const files = {
  get: (trackId, name) => tx('files', 'readonly', (s) => wrap(s.get(`${trackId}/${name}`))),
  put: (trackId, name, blob) => tx('files', 'readwrite', (s) => wrap(s.put(blob, `${trackId}/${name}`))),
  del: (trackId, name) => tx('files', 'readwrite', (s) => wrap(s.delete(`${trackId}/${name}`))),
  /** 曲のファイルをまとめて消す */
  delTrack: (trackId) =>
    tx('files', 'readwrite', (s) => wrap(s.delete(IDBKeyRange.bound(`${trackId}/`, `${trackId}/￿`)))),
};

export const lyricsStore = {
  get: (trackId) => tx('lyrics', 'readonly', (s) => wrap(s.get(trackId))),
  put: (trackId, text) => tx('lyrics', 'readwrite', (s) => wrap(s.put(text, trackId))),
  del: (trackId) => tx('lyrics', 'readwrite', (s) => wrap(s.delete(trackId))),
  allKeys: () => tx('lyrics', 'readonly', (s) => wrap(s.getAllKeys())),
};

/** 版付きの JSON を最新の形にする（Android 版の VersionedJsonFile と同じ考え方） */
export function upgrade(name, json) {
  const f = FORMATS[name];
  let obj = json;
  // v1 は配列そのもの（Android 版の古い形式）
  if (Array.isArray(obj)) obj = { formatVersion: 1, items: obj };
  let v = obj && typeof obj === 'object' ? Number(obj.formatVersion || 0) : 0;
  if (v < 1) throw new Error(`${name} の形式が分かりません`);
  if (v > f.current) throw new Error(`${name} は新しいバージョンのアプリで保存されています`);
  while (v < f.current) {
    if (name === 'library' && v === 1) obj = { tracks: obj.items || [] };
    else if (name === 'playlists' && v === 1) obj = { playlists: obj.items || [] };
    else if (f.migrations[v]) obj = f.migrations[v](obj);
    else throw new Error(`${name} の形式 ${v} を変換できません`);
    v++;
    obj = { ...obj, formatVersion: v };
  }
  return obj;
}

/** kv から版付きの JSON を読む。古ければ控えを取ってから変換して保存し直す */
export async function loadVersioned(name, empty) {
  const raw = await kv.get(name);
  if (raw == null) return { formatVersion: FORMATS[name].current, ...empty };
  const before = Number(raw.formatVersion || 0);
  try {
    const obj = upgrade(name, raw);
    if (before !== obj.formatVersion) {
      await kv.set(`backup:${name}:${Date.now()}`, raw);
      await kv.set(name, obj);
    }
    return obj;
  } catch (e) {
    // 読めないデータは消さずに控えへ移す
    await kv.set(`unreadable:${name}:${Date.now()}`, raw);
    throw e;
  }
}

export async function saveVersioned(name, obj) {
  await kv.set(name, { ...obj, formatVersion: FORMATS[name].current });
}

/** iPhone が容量不足のときに勝手に消さないよう頼む */
export async function requestPersist() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) || false;
  } catch {
    return false;
  }
}

export async function estimate() {
  try {
    return (await navigator.storage?.estimate?.()) || {};
  } catch {
    return {};
  }
}
