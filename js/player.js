// 再生エンジン：1つの audio 要素で順番に流す。ロック画面とコントロールセンターの操作（Media Session）に対応
//
// 再生キュー
// - order … 実際に流す順の曲 ID（シャッフル中はシャッフルした順）
// - base  … シャッフルしていないときの順（シャッフルを切ったら、この順に戻す）
// - 「次に再生」は今の曲のすぐ後ろ、「再生キューに追加」は最後に入れる（シャッフル中でも。Android 版と同じ）
import * as store from './store.js';
import { files, kv } from './db.js';

const audio = new Audio();
audio.preload = 'auto';
audio.setAttribute('playsinline', '');
audio.setAttribute('webkit-playsinline', '');

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of listeners) fn(q);
}

export const q = {
  order: [],
  base: [],
  pos: -1,
  shuffle: false,
  repeat: 'off', // off / all / one
  playing: false,
  /** 今の曲の ID */
  get currentId() {
    return this.order[this.pos] ?? null;
  },
  get current() {
    return this.currentId ? store.getTrack(this.currentId) : null;
  },
  error: null,
};

export { audio };

let mediaUrl = null;
let loadedId = null;

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function currentTimeMs() {
  return audio.currentTime * 1000;
}

export function durationMs() {
  const d = audio.duration;
  if (isFinite(d) && d > 0) return d * 1000;
  return q.current?.durationMs || 0;
}

async function load(autoplay) {
  const t = q.current;
  q.error = null;
  if (!t) {
    audio.pause();
    audio.removeAttribute('src');
    loadedId = null;
    emit();
    return;
  }
  if (loadedId !== t.id) {
    const blob = await files.get(t.id, t.mediaFile);
    if (!blob) {
      q.error = 'この曲のファイルがありません（音声を含めずに復元した曲かもしれません）';
      emit();
      return;
    }
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    mediaUrl = URL.createObjectURL(blob);
    audio.src = mediaUrl;
    loadedId = t.id;
    await updateMediaSession(t);
  }
  if (autoplay) {
    try {
      await audio.play();
    } catch (e) {
      if (e.name !== 'AbortError') q.error = '再生できませんでした。もう一度押してください';
    }
  }
  saveSession();
  emit();
}

function toDataUrl(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.readAsDataURL(blob);
  });
}

async function updateMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  let artwork = [];
  if (t.thumbFile) {
    const b = await files.get(t.id, t.thumbFile);
    // ロック画面のジャケットは、blob: の URL だと出ないことがあるので data: にする
    const src = b ? await toDataUrl(b) : null;
    if (src) artwork = [{ src, sizes: '600x600', type: b.type || 'image/jpeg' }];
  }
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist || '', album: t.album || '', artwork });
}

/** 曲の一覧を渡して、startId の曲から再生する */
export async function playList(ids, startId = ids[0], { shuffle = q.shuffle } = {}) {
  if (!ids.length) return;
  q.base = [...ids];
  q.shuffle = shuffle;
  if (shuffle) {
    const first = startId ?? ids[Math.floor(Math.random() * ids.length)];
    q.order = [first, ...shuffled(ids.filter((id) => id !== first))];
    q.pos = 0;
  } else {
    q.order = [...ids];
    q.pos = Math.max(0, ids.indexOf(startId));
  }
  loadedId = null;
  await load(true);
}

export async function shuffleAll(ids) {
  if (!ids.length) return;
  await playList(ids, ids[Math.floor(Math.random() * ids.length)], { shuffle: true });
}

export async function toggle() {
  if (!q.current) return;
  if (audio.paused) {
    if (loadedId !== q.currentId) await load(true);
    else
      try {
        await audio.play();
      } catch {
        /* 次の操作で */
      }
  } else audio.pause();
}

export async function next(auto = false) {
  if (!q.order.length) return;
  if (auto && q.repeat === 'one') {
    audio.currentTime = 0;
    await audio.play().catch(() => {});
    return;
  }
  if (q.pos + 1 < q.order.length) q.pos++;
  else if (q.repeat === 'all') q.pos = 0;
  else if (auto) {
    // 最後まで流れた
    audio.pause();
    audio.currentTime = 0;
    emit();
    return;
  } else {
    // 最後の曲で「次へ」：最初の曲に戻して止める
    audio.pause();
    q.pos = 0;
    audio.currentTime = 0;
    await load(false);
    return;
  }
  await load(true);
}

export async function prev() {
  if (!q.order.length) return;
  if (audio.currentTime > 3 || q.pos === 0) {
    audio.currentTime = 0;
    emit();
    return;
  }
  q.pos--;
  await load(true);
}

export function seek(ms) {
  if (!q.current) return;
  audio.currentTime = Math.max(0, ms / 1000);
  emit();
}

export async function jumpTo(pos) {
  if (pos < 0 || pos >= q.order.length) return;
  q.pos = pos;
  await load(true);
}

export function setShuffle(on) {
  if (on === q.shuffle) return;
  const cur = q.currentId;
  q.shuffle = on;
  if (on) {
    const rest = q.order.slice(q.pos + 1);
    q.order = [...q.order.slice(0, q.pos + 1), ...shuffled(rest)];
  } else {
    q.order = [...q.base];
    q.pos = Math.max(0, q.order.indexOf(cur));
  }
  saveSession();
  emit();
}

export function cycleRepeat() {
  q.repeat = q.repeat === 'off' ? 'all' : q.repeat === 'all' ? 'one' : 'off';
  saveSession();
  emit();
}

/** 次に再生 */
export function playNext(ids) {
  if (!q.order.length) return playList(ids, ids[0], { shuffle: false });
  const cur = q.currentId;
  q.order.splice(q.pos + 1, 0, ...ids);
  const bi = q.base.indexOf(cur);
  q.base.splice(bi + 1, 0, ...ids);
  saveSession();
  emit();
}

/** 再生キューに追加 */
export function addToQueue(ids) {
  if (!q.order.length) return playList(ids, ids[0], { shuffle: false });
  q.order.push(...ids);
  q.base.push(...ids);
  saveSession();
  emit();
}

/** キューから外す（今の曲は外さない） */
export function removeFromQueue(pos) {
  if (pos === q.pos || pos < 0 || pos >= q.order.length) return;
  const [id] = q.order.splice(pos, 1);
  const bi = q.base.indexOf(id);
  if (bi >= 0) q.base.splice(bi, 1);
  if (pos < q.pos) q.pos--;
  saveSession();
  emit();
}

/** 曲が消されたとき */
function onTracksChanged() {
  const exists = new Set(store.state.tracks.map((t) => t.id));
  const cur = q.currentId;
  if (q.order.every((id) => exists.has(id))) {
    if (cur) updateMediaSession(q.current);
    emit();
    return;
  }
  q.order = q.order.filter((id) => exists.has(id));
  q.base = q.base.filter((id) => exists.has(id));
  if (cur && !exists.has(cur)) {
    audio.pause();
    q.pos = Math.min(q.pos, q.order.length - 1);
    loadedId = null;
    load(false);
  } else q.pos = q.order.indexOf(cur);
  saveSession();
  emit();
}

let saveTimer = null;
function saveSession() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    kv.set('session', {
      order: q.order,
      base: q.base,
      pos: q.pos,
      shuffle: q.shuffle,
      repeat: q.repeat,
      timeMs: Math.round(audio.currentTime * 1000) || 0,
    }).catch(() => {});
  }, 400);
}

/** 前回の続き（再生はしない） */
export async function restoreSession() {
  const s = await kv.get('session');
  if (!s || !Array.isArray(s.order)) return;
  const exists = new Set(store.state.tracks.map((t) => t.id));
  const cur = s.order[s.pos];
  q.order = s.order.filter((id) => exists.has(id));
  q.base = (s.base || s.order).filter((id) => exists.has(id));
  q.pos = Math.max(0, q.order.indexOf(cur));
  q.shuffle = !!s.shuffle;
  q.repeat = s.repeat || 'off';
  if (!q.order.length) {
    q.pos = -1;
    return;
  }
  await load(false);
  if (cur === q.currentId && s.timeMs) {
    const set = () => {
      audio.currentTime = s.timeMs / 1000;
      emit();
    };
    if (audio.readyState >= 1) set();
    else audio.addEventListener('loadedmetadata', set, { once: true });
  }
}

// 再生できなかった動画の曲は、音声だけを取り出して置き換えてから、もう一度再生する
// （1080p の動画は映像が AV1 などで、iPhone によっては映像も音声も再生できないため）
const triedConvert = new Set();
async function recoverFromError() {
  const t = q.current;
  const { convertTrackToAudio, isVideoTrack } = await import('./importer.js');
  if (!t || !isVideoTrack(t) || triedConvert.has(t.id)) {
    q.error = 'この形式は iPhone で再生できないようです';
    emit();
    return;
  }
  triedConvert.add(t.id);
  const at = audio.currentTime;
  q.error = 'この動画は iPhone で再生できない形式なので、音声だけを取り出しています…';
  emit();
  try {
    await convertTrackToAudio(t.id);
    q.error = null;
    loadedId = null;
    await load(true);
    if (at > 1) audio.currentTime = at;
  } catch (e) {
    q.error = `再生できませんでした（${e.message}）`;
    emit();
  }
}

// iPhone は、指で触った直後でないと音を出させてくれない。最初に触ったときに audio を「起こして」おくと、
// そのあとは曲のデータを読み込んでから（少し待ってから）でも再生できる
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
function unlockAudio() {
  if (audio.getAttribute('src') && loadedId) {
    const t = audio.currentTime;
    audio.muted = true;
    audio
      .play()
      .then(() => {
        audio.pause();
        audio.currentTime = t;
      })
      .catch(() => {})
      .finally(() => (audio.muted = false));
    return;
  }
  audio.src = SILENT;
  audio.play().catch(() => {});
}

export function init() {
  document.addEventListener('touchend', unlockAudio, { once: true, capture: true });
  document.addEventListener('click', unlockAudio, { once: true, capture: true });
  // 本当の長さが分かったら、曲の情報を直す（取り込みのときに長さを取れなかった曲のため）
  audio.addEventListener('loadedmetadata', () => {
    const t = q.current;
    if (!t || loadedId !== t.id || !isFinite(audio.duration)) return;
    const ms = Math.round(audio.duration * 1000);
    if (Math.abs((t.durationMs || 0) - ms) > 1500) store.updateTrack(t.id, { durationMs: ms });
  });
  // 「起こす」ための無音の再生は、曲の再生として扱わない
  const silent = () => audio.src.startsWith('data:');
  audio.addEventListener('play', () => {
    if (silent()) return;
    q.playing = true;
    emit();
  });
  audio.addEventListener('pause', () => {
    if (silent()) return;
    q.playing = false;
    saveSession();
    emit();
  });
  audio.addEventListener('ended', () => !silent() && next(true));
  audio.addEventListener('error', () => {
    if (!audio.getAttribute('src') || silent()) return;
    recoverFromError();
  });
  let lastPos = 0;
  audio.addEventListener('timeupdate', () => {
    if (Math.abs(audio.currentTime - lastPos) > 5) {
      lastPos = audio.currentTime;
      saveSession();
    }
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && isFinite(audio.duration)) {
      try {
        navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: audio.playbackRate });
      } catch {
        /* 古い iOS */
      }
    }
  });
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const set = (a, h) => {
      try {
        ms.setActionHandler(a, h);
      } catch {
        /* 対応していない操作 */
      }
    };
    set('play', () => toggle());
    set('pause', () => audio.pause());
    set('nexttrack', () => next());
    set('previoustrack', () => prev());
    set('seekto', (d) => seek(d.seekTime * 1000));
  }
  store.subscribe((what) => {
    if (what === 'tracks' || what === 'all') onTracksChanged();
  });
}
