// アプリのデータ（曲・プレイリスト・設定）。変わったら "change" を知らせる
import { loadVersioned, saveVersioned, files, lyricsStore } from './db.js';

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(what) {
  for (const fn of listeners) fn(what);
}

export const DEFAULT_SETTINGS = {
  autoFetchLyrics: true,
  /** 歌詞をカラオケ風に塗る */
  karaoke: true,
};

export const state = {
  tracks: [],
  playlists: [],
  settings: { ...DEFAULT_SETTINGS },
  lyricsIds: new Set(),
  loaded: false,
  issues: [],
};

export async function load() {
  try {
    state.tracks = (await loadVersioned('library', { tracks: [] })).tracks || [];
  } catch (e) {
    state.issues.push(`曲の情報を読めませんでした（${e.message}）。元のデータは控えに残しています。`);
  }
  try {
    state.playlists = (await loadVersioned('playlists', { playlists: [] })).playlists || [];
  } catch (e) {
    state.issues.push(`プレイリストを読めませんでした（${e.message}）。`);
  }
  try {
    const s = await loadVersioned('settings', {});
    state.settings = { ...DEFAULT_SETTINGS, ...pick(s, Object.keys(DEFAULT_SETTINGS)) };
  } catch {
    state.settings = { ...DEFAULT_SETTINGS };
  }
  state.lyricsIds = new Set(await lyricsStore.allKeys());
  state.loaded = true;
  emit('all');
}

function pick(obj, keys) {
  const o = {};
  for (const k of keys) if (k in obj) o[k] = obj[k];
  return o;
}

async function saveLibrary() {
  await saveVersioned('library', { tracks: state.tracks });
}
async function savePlaylists() {
  await saveVersioned('playlists', { playlists: state.playlists });
}

export function newId() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getTrack(id) {
  return state.tracks.find((t) => t.id === id) || null;
}

export async function addTrack(track) {
  state.tracks = [track, ...state.tracks];
  await saveLibrary();
  emit('tracks');
}

export async function updateTrack(id, patch) {
  state.tracks = state.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t));
  await saveLibrary();
  emit('tracks');
}

export async function deleteTracks(ids) {
  const set = new Set(ids);
  state.tracks = state.tracks.filter((t) => !set.has(t.id));
  state.playlists = state.playlists.map((p) =>
    p.trackIds.some((id) => set.has(id)) ? { ...p, trackIds: p.trackIds.filter((id) => !set.has(id)), updatedAt: Date.now() } : p,
  );
  await saveLibrary();
  await savePlaylists();
  for (const id of ids) {
    await files.delTrack(id);
    await lyricsStore.del(id);
    state.lyricsIds.delete(id);
  }
  emit('tracks');
  emit('playlists');
}

// ---- 歌詞 ----
export async function getLyrics(id) {
  return (await lyricsStore.get(id)) || null;
}
export async function saveLyrics(id, text) {
  await lyricsStore.put(id, `${text.trim()}\n`);
  state.lyricsIds.add(id);
  emit('lyrics:' + id);
}
export async function deleteLyrics(id) {
  await lyricsStore.del(id);
  state.lyricsIds.delete(id);
  emit('lyrics:' + id);
}

// ---- プレイリスト ----
export async function createPlaylist(name, trackIds = []) {
  const now = Date.now();
  const p = { id: crypto.randomUUID ? crypto.randomUUID() : newId(), name, trackIds: [...new Set(trackIds)], createdAt: now, updatedAt: now };
  state.playlists = [...state.playlists, p];
  await savePlaylists();
  emit('playlists');
  return p;
}

async function mutatePlaylist(id, f) {
  state.playlists = state.playlists.map((p) => (p.id === id ? { ...f(p), updatedAt: Date.now() } : p));
  await savePlaylists();
  emit('playlists');
}

export const renamePlaylist = (id, name) => mutatePlaylist(id, (p) => ({ ...p, name }));
export const addToPlaylist = (id, trackIds) =>
  mutatePlaylist(id, (p) => ({ ...p, trackIds: [...p.trackIds, ...[...new Set(trackIds)].filter((t) => !p.trackIds.includes(t))] }));
export const removeFromPlaylist = (id, trackId) => mutatePlaylist(id, (p) => ({ ...p, trackIds: p.trackIds.filter((t) => t !== trackId) }));
export const reorderPlaylist = (id, trackIds) => mutatePlaylist(id, (p) => ({ ...p, trackIds }));

export async function deletePlaylist(id) {
  state.playlists = state.playlists.filter((p) => p.id !== id);
  await savePlaylists();
  emit('playlists');
}

// ---- 設定 ----
export async function setSetting(key, value) {
  state.settings = { ...state.settings, [key]: value };
  await saveVersioned('settings', state.settings);
  emit('settings');
}

/** 復元などでまとめて入れ替えたあと */
export async function replaceAll({ tracks, playlists }) {
  if (tracks) state.tracks = tracks;
  if (playlists) state.playlists = playlists;
  await saveLibrary();
  await savePlaylists();
  state.lyricsIds = new Set(await lyricsStore.allKeys());
  emit('all');
}

export function notify(what) {
  emit(what);
}
