// よく使うサイト（ブラウザのタブ）。kv の bookmarks に版付きで保存する
import { loadVersioned, saveVersioned } from './db.js';

export const DEFAULT_BOOKMARKS = [
  { id: 'google', name: 'Google', url: 'https://www.google.com/', search: 'https://www.google.com/search?q={q}' },
  { id: 'youtube', name: 'YouTube', url: 'https://m.youtube.com/', search: 'https://m.youtube.com/results?search_query={q}' },
  // ニコニコは言葉をパスに入れる（Android 版と同じ）
  { id: 'niconico', name: 'ニコニコ', url: 'https://sp.nicovideo.jp/', search: 'https://sp.nicovideo.jp/search/{q}' },
];

let bookmarks = [];

export async function loadBookmarks() {
  try {
    bookmarks = (await loadVersioned('bookmarks', { bookmarks: DEFAULT_BOOKMARKS })).bookmarks || [];
  } catch {
    bookmarks = [...DEFAULT_BOOKMARKS];
  }
  return bookmarks;
}

export function getBookmarks() {
  return bookmarks;
}

export async function setBookmarks(list) {
  bookmarks = list;
  await saveVersioned('bookmarks', { bookmarks });
}

