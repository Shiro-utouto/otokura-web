// 無料の歌詞データベース LRCLIB (https://lrclib.net) の検索と、取り込み直後の自動取得
// （Android 版 lyrics/LrcLib.kt と LyricsRepository.autoFetch の移植）
import { looksSwapped } from './titleCleaner.js';
import { parseLrc } from './lrc.js';

const BASE = 'https://lrclib.net/api';

let fetchImpl = (...a) => fetch(...a);
/** テスト用に fetch を差し替える */
export function setFetch(f) {
  fetchImpl = f;
}

async function request(url) {
  // 独自のヘッダーを付けると、ブラウザが事前確認（CORS のプリフライト）をするので付けない
  const res = await fetchImpl(url);
  if (!res.ok) return [];
  const arr = await res.json();
  if (!Array.isArray(arr)) return [];
  return arr.map((o) => ({
    id: o.id,
    trackName: o.trackName || '',
    artistName: o.artistName || '',
    albumName: o.albumName || '',
    durationSec: Number.isFinite(o.duration) ? o.duration : 0,
    instrumental: !!o.instrumental,
    synced: (o.syncedLyrics || '').trim() || null,
    plain: (o.plainLyrics || '').trim() || null,
  }));
}

const enc = encodeURIComponent;

export async function search(title, artist) {
  const t = (title || '').trim();
  if (!t) return [];
  const a = (artist || '').trim();
  if (a) {
    const r = await request(`${BASE}/search?track_name=${enc(t)}&artist_name=${enc(a)}`);
    if (r.length) return r;
    const q = await request(`${BASE}/search?q=${enc(`${a} ${t}`)}`);
    if (q.length) return q;
  }
  return request(`${BASE}/search?track_name=${enc(t)}`);
}

/**
 * 取り込み直後に自動で歌詞を探す。
 * 1. LRCLIB の同期歌詞（曲の長さが合うもの）
 * 2. ファイルの中に入っていた歌詞（タイミング付きなら）
 * 3. LRCLIB のテキストのみの歌詞
 * 4. ファイルの中のテキストの歌詞
 * @returns {Promise<{ lyrics: string|null, swap: boolean, source: string|null }>}
 */
export async function autoFetch({ title, artist, durationMs }, embedded = null) {
  const durSec = (durationMs || 0) / 1000;
  const durationOk = (r) => durSec <= 0 || r.durationSec <= 0 || Math.abs(r.durationSec - durSec) <= 4;
  const candidatesFor = async (t, a) => {
    try {
      return (await search(t, a || null)).filter((r) => !r.instrumental && durationOk(r));
    } catch {
      return [];
    }
  };

  let candidates = await candidatesFor(title, artist);
  let swapped = false;
  // 曲名とアーティストの推測が逆のこともあるので、タイミング付きの歌詞が見つからなければ入れ替えても探す
  if (!candidates.some((c) => c.synced) && (artist || '').trim()) {
    const alt = await candidatesFor(artist, title);
    if (alt.some((c) => c.synced)) {
      candidates = alt;
      swapped = true;
    }
  }
  const best = candidates.find((c) => c.synced) || candidates.find((c) => c.plain);
  const swap = !!best && looksSwapped(title, artist || '', best.trackName, best.artistName);

  const synced = candidates.find((c) => c.synced)?.synced;
  if (synced) return { lyrics: synced, swap, source: 'lrclib', swapped };
  if (embedded && parseLrc(embedded).synced) return { lyrics: embedded, swap: false, source: 'file' };
  const plain = candidates.find((c) => c.plain)?.plain;
  if (plain) return { lyrics: plain, swap, source: 'lrclib' };
  if (embedded && embedded.trim()) return { lyrics: embedded, swap: false, source: 'file' };
  return { lyrics: null, swap: false, source: null };
}
