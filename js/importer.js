// 「ファイル」アプリから選んだ曲をライブラリに追加する
// 曲のファイルは iPhone の中（IndexedDB）にコピーする。元のファイルを消しても再生できる
import { readTags } from './tags.js';
import { decideTitleArtist, isMediaFile, isLyricsFile, isImageFile, baseName, extensionOf, isVideoName } from './localFiles.js';
import { probeMedia, resizeImage, extractColors } from './image.js';
import { files } from './db.js';
import * as store from './store.js';
import { autoFetch } from './lrclib.js';
import { extractAudioM4a } from './mp4audio.js';

/** 同じファイルを2回追加しないための目印（元の名前と大きさ） */
export function duplicateKey(name, size) {
  return `${name.trim()}\t${size}`;
}

const MIME_BY_EXT = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  caf: 'audio/x-caf',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

async function readText(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    // UTF-8 で読めなければ Shift_JIS（日本の古い .lrc 対策）
    return new TextDecoder('shift_jis').decode(buf);
  }
}

// ---- 歌詞の自動取得の順番待ち（取り込みを止めないよう、あとで1曲ずつ） ----
const lyricsQueue = [];
let lyricsRunning = false;
export const lyricsStatus = { pending: 0, current: null };

export function queueLyrics(trackId, embedded = null) {
  lyricsQueue.push({ trackId, embedded });
  lyricsStatus.pending = lyricsQueue.length;
  store.notify('lyricsQueue');
  runLyricsQueue();
}

async function runLyricsQueue() {
  if (lyricsRunning) return;
  lyricsRunning = true;
  while (lyricsQueue.length) {
    const { trackId, embedded } = lyricsQueue.shift();
    lyricsStatus.pending = lyricsQueue.length;
    const t = store.getTrack(trackId);
    if (!t || store.state.lyricsIds.has(trackId)) continue;
    lyricsStatus.current = t.title;
    store.notify('lyricsQueue');
    try {
      const r = await autoFetch(t, embedded);
      if (r.lyrics) await store.saveLyrics(trackId, r.lyrics);
      // 見つかった曲の名前から、曲名とアーティストの推測が逆だったと分かれば直す
      if (r.swap) await store.updateTrack(trackId, { title: t.artist, artist: t.title });
    } catch (e) {
      console.warn('歌詞の自動取得に失敗', e);
    }
  }
  lyricsStatus.current = null;
  lyricsStatus.pending = 0;
  lyricsRunning = false;
  store.notify('lyricsQueue');
}

/**
 * @param {File[]} list
 * @param {(p: {done: number, total: number, name: string}) => void} onProgress
 * @returns {Promise<{ added: object[], skipped: string[], failed: string[], lyricsAttached: number }>}
 */
export async function importFiles(list, onProgress = () => {}) {
  const all = [...list];
  const media = all.filter((f) => isMediaFile(f.name, f.type));
  const lyricFiles = new Map(all.filter((f) => isLyricsFile(f.name)).map((f) => [baseName(f.name).toLowerCase(), f]));
  // 同じ名前の画像（yt-dlp の --write-thumbnail の .webp など）はジャケットにする
  const imageFiles = new Map(all.filter((f) => isImageFile(f.name, f.type)).map((f) => [baseName(f.name).toLowerCase(), f]));
  const existing = new Set(store.state.tracks.map((t) => t.sourceKey).filter(Boolean));
  const result = { added: [], skipped: [], failed: [], lyricsAttached: 0 };

  for (let i = 0; i < media.length; i++) {
    const f = media[i];
    onProgress({ done: i, total: media.length, name: f.name });
    const key = duplicateKey(f.name, f.size);
    if (existing.has(key)) {
      result.skipped.push(f.name);
      continue;
    }
    try {
      const track = await addOne(f, key, imageFiles.get(baseName(f.name).toLowerCase()) || null);
      existing.add(key);
      result.added.push(track);
      // 同じ名前の .lrc / .txt があれば歌詞にする
      const lf = lyricFiles.get(baseName(f.name).toLowerCase());
      if (lf) {
        await store.saveLyrics(track.id, await readText(lf));
        result.lyricsAttached++;
      } else if (store.state.settings.autoFetchLyrics) {
        queueLyrics(track.id, track._embeddedLyrics || null);
      } else if (track._embeddedLyrics) {
        await store.saveLyrics(track.id, track._embeddedLyrics);
      }
      delete track._embeddedLyrics;
    } catch (e) {
      console.error(e);
      result.failed.push(f.name);
    }
  }
  // 歌詞のファイルだけを選んだ場合：同じ名前の曲があれば付ける
  if (!media.length && lyricFiles.size) {
    for (const [base, lf] of lyricFiles) {
      const t = store.state.tracks.find((x) => x.sourceKey && baseName(x.sourceKey.split('\t')[0]).toLowerCase() === base);
      if (t) {
        await store.saveLyrics(t.id, await readText(lf));
        result.lyricsAttached++;
      }
    }
  }
  onProgress({ done: media.length, total: media.length, name: '' });
  return result;
}

async function addOne(file, sourceKey, coverFile = null) {
  const ext = extensionOf(file.name) || 'bin';
  const type = file.type || MIME_BY_EXT[ext] || 'application/octet-stream';
  const tags = await readTags(file);
  let src = file;
  let outExt = ext;
  let outType = type;
  let frame = null;
  let converted = false;
  // 動画は音声だけにして保存する（iPhone が再生できない映像の形式でも聞けて、容量も小さくなる）
  if (tags.hasVideo && store.state.settings.videoAsAudio) {
    if (!tags.picture) frame = (await probeMedia(file, true)).frame;
    try {
      src = await extractAudioM4a(file);
      outExt = 'm4a';
      outType = 'audio/mp4';
      converted = true;
    } catch (e) {
      console.warn('音声だけにできませんでした', e);
    }
  }
  // File のまま保存すると、Safari では元の場所の参照になることがあるので、中身をコピーする
  const blob = new Blob([await src.arrayBuffer()], { type: outType });
  // 長さがタグから分かる音声だけの曲は、再生の仕組みで調べない（iPhone では時間がかかることがあるため）
  const maybeVideo = !converted && (!!tags.hasVideo || (isVideoName(file.name) && tags.hasVideo !== false));
  const probe =
    maybeVideo || !tags.durationMs ? await probeMedia(blob, !tags.picture && !frame && maybeVideo) : { durationMs: 0, hasVideo: false, frame: null };
  probe.frame = probe.frame || frame;
  const isVideo = !converted && !!(probe.hasVideo || tags.hasVideo);

  const [title, artist] = decideTitleArtist(file.name, tags.title, tags.artist || tags.albumArtist);
  const id = store.newId();
  const mediaFile = `media.${outExt}`;
  await files.put(id, mediaFile, blob);

  let thumbFile = null;
  let colors = null;
  const coverSrc = tags.picture || coverFile || probe.frame;
  if (coverSrc) {
    const cover = (await resizeImage(coverSrc)) || coverSrc;
    thumbFile = 'cover.jpg';
    await files.put(id, thumbFile, cover);
    colors = await extractColors(cover);
  }

  const track = {
    id,
    title: title || baseName(file.name),
    artist: artist || '',
    durationMs: probe.durationMs || tags.durationMs || 0,
    mediaFile,
    thumbFile,
    sourceUrl: '',
    isVideo,
    addedAt: Date.now(),
    lyricsOffsetMs: 0,
    // ここから下は iPhone 版だけの項目（Android 版は読み飛ばす）
    album: tags.album || '',
    size: blob.size,
    sourceKey,
    colors,
  };
  await store.addTrack(track);
  return { ...track, _embeddedLyrics: tags.lyrics || null };
}

/** 取り込み済みの動画の曲を、音声だけ（m4a）に置き換える。成功したら減った容量を返す */
export async function convertTrackToAudio(trackId) {
  const t = store.getTrack(trackId);
  if (!t) throw new Error('曲が見つかりません');
  const old = await files.get(t.id, t.mediaFile);
  if (!old) throw new Error('曲のファイルがありません');
  const audio = await extractAudioM4a(old);
  const blob = new Blob([await audio.arrayBuffer()], { type: 'audio/mp4' });
  const name = t.mediaFile === 'media.m4a' ? 'media-audio.m4a' : 'media.m4a';
  await files.put(t.id, name, blob);
  await store.updateTrack(t.id, { mediaFile: name, isVideo: false, size: blob.size });
  await files.del(t.id, t.mediaFile);
  return old.size - blob.size;
}

export function isVideoTrack(t) {
  return !!t && (t.isVideo || /\.(mp4|m4v|mov)$/i.test(t.mediaFile || ''));
}
