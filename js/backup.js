// バックアップと復元。zip の形は Android 版の音蔵と同じ（backup/BackupArchive.kt）
//
// manifest.json   … バックアップの情報（app: "otokura", backupFormatVersion など）。zip の先頭に置く
// library.json    … 曲の情報（formatVersion 付き）
// playlists.json  … プレイリスト
// settings.json   … アプリの設定
// tracks/<id>/…   … 歌詞（lyrics.lrc）、ジャケット、曲のファイル（含めるときだけ）
import { ZipWriter, readZip } from './zip.js';
import { FORMATS, upgrade, files, lyricsStore } from './db.js';
import * as store from './store.js';
import { extractColors } from './image.js';

export const BACKUP_FORMAT = 1;
// 設定の「このアプリについて」に出る版。sw.js の VERSION と同じ番号にする（iPhone で新しい版になったか確かめるため）
export const APP_VERSION = '5';

const TRACK_ENTRY = /^tracks\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9_-][A-Za-z0-9._-]{0,127})$/;

/** Android 版が読めるよう、曲の情報は Android 版の項目を必ず入れる */
function trackForBackup(t) {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    durationMs: t.durationMs || 0,
    mediaFile: t.mediaFile,
    thumbFile: t.thumbFile || '',
    sourceUrl: t.sourceUrl || '',
    isVideo: !!t.isVideo,
    addedAt: t.addedAt || 0,
    lyricsOffsetMs: t.lyricsOffsetMs || 0,
    album: t.album || '',
    size: t.size || 0,
    sourceKey: t.sourceKey || '',
  };
}

/**
 * @param {{ includeMedia: boolean, onProgress?: (done:number,total:number)=>void }} opts
 * @returns {Promise<Blob>}
 */
export async function createBackup({ includeMedia, onProgress = () => {} }) {
  const { tracks, playlists, settings } = store.state;
  const lyricIds = new Set(await lyricsStore.allKeys());
  const zip = new ZipWriter();
  const manifest = {
    app: 'otokura',
    backupFormatVersion: BACKUP_FORMAT,
    appVersionCode: 0,
    appVersionName: APP_VERSION,
    createdAt: Date.now(),
    includesMedia: includeMedia,
    formats: { library: FORMATS.library.current, playlists: FORMATS.playlists.current, settings: FORMATS.settings.current },
    counts: { tracks: tracks.length, playlists: playlists.length, lyrics: tracks.filter((t) => lyricIds.has(t.id)).length },
  };
  await zip.add('manifest.json', JSON.stringify(manifest, null, 2));
  await zip.add('library.json', JSON.stringify({ formatVersion: FORMATS.library.current, tracks: tracks.map(trackForBackup) }));
  await zip.add('playlists.json', JSON.stringify({ formatVersion: FORMATS.playlists.current, playlists }));
  await zip.add('settings.json', JSON.stringify({ formatVersion: FORMATS.settings.current, ...settings }));
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    onProgress(i, tracks.length);
    if (lyricIds.has(t.id)) {
      const text = await lyricsStore.get(t.id);
      if (text) await zip.add(`tracks/${t.id}/lyrics.lrc`, new Blob([text], { type: 'text/plain' }));
    }
    if (t.thumbFile) {
      const b = await files.get(t.id, t.thumbFile);
      if (b) await zip.add(`tracks/${t.id}/${t.thumbFile}`, b);
    }
    if (includeMedia) {
      const b = await files.get(t.id, t.mediaFile);
      if (b) await zip.add(`tracks/${t.id}/${t.mediaFile}`, b);
    }
  }
  onProgress(tracks.length, tracks.length);
  return zip.finish();
}

/** 復元の前の確認用 */
export async function inspectBackup(blob) {
  const entries = await readZip(blob);
  const m = entries.find((e) => e.name === 'manifest.json');
  if (!m) throw new Error('音蔵のバックアップではありません');
  const manifest = JSON.parse(await m.text());
  if (manifest.app !== 'otokura') throw new Error('音蔵のバックアップではありません');
  if (!(manifest.backupFormatVersion >= 1)) throw new Error('バックアップの形式が分かりません');
  if (manifest.backupFormatVersion > BACKUP_FORMAT) throw new Error('新しいバージョンのアプリで作ったバックアップです');
  return { manifest, entries };
}

const MEDIA_TYPES = { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', opus: 'audio/ogg', ogg: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/**
 * 復元（統合）：今の曲は残し、バックアップの曲を足す・上書きする。プレイリストも ID ごとに統合
 * @returns {Promise<{ tracks: number, playlists: number, lyrics: number, missingMedia: number }>}
 */
export async function restoreBackup(blob, onProgress = () => {}) {
  const { entries } = await inspectBackup(blob);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const lib = byName.get('library.json');
  if (!lib) throw new Error('バックアップに曲の情報がありません');
  const tracksIn = upgrade('library', JSON.parse(await lib.text())).tracks || [];
  const plEntry = byName.get('playlists.json');
  const playlistsIn = plEntry ? upgrade('playlists', JSON.parse(await plEntry.text())).playlists || [] : [];

  // 曲のファイルを先に書く（読めない名前は飛ばす）
  const fileEntries = entries.filter((e) => !e.isDir && TRACK_ENTRY.test(e.name) && !e.name.includes('..'));
  const ids = new Set(tracksIn.map((t) => t.id));
  let lyrics = 0;
  for (let i = 0; i < fileEntries.length; i++) {
    const e = fileEntries[i];
    onProgress(i, fileEntries.length);
    const [, id, name] = TRACK_ENTRY.exec(e.name);
    if (!ids.has(id)) continue;
    if (name === 'lyrics.lrc') {
      await lyricsStore.put(id, await e.text());
      lyrics++;
    } else {
      const ext = name.split('.').pop().toLowerCase();
      await files.put(id, name, await e.blob(MEDIA_TYPES[ext] || ''));
    }
  }

  const current = new Map(store.state.tracks.map((t) => [t.id, t]));
  let missingMedia = 0;
  for (const t of tracksIn) {
    const media = await files.get(t.id, t.mediaFile);
    if (!media) missingMedia++;
    const thumb = t.thumbFile ? await files.get(t.id, t.thumbFile) : null;
    const merged = {
      ...current.get(t.id),
      ...t,
      thumbFile: thumb ? t.thumbFile : null,
      isVideo: !!t.isVideo,
      size: media?.size || t.size || 0,
      missingMedia: !media,
      colors: current.get(t.id)?.colors || (thumb ? await extractColors(thumb) : null),
    };
    current.set(t.id, merged);
  }
  const tracks = [...current.values()].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  const pl = new Map(store.state.playlists.map((p) => [p.id, p]));
  for (const p of playlistsIn) pl.set(p.id, { ...p, trackIds: (p.trackIds || []).filter((id) => current.has(id)) });
  await store.replaceAll({ tracks, playlists: [...pl.values()] });
  onProgress(fileEntries.length, fileEntries.length);
  return { tracks: tracksIn.length, playlists: playlistsIn.length, lyrics, missingMedia };
}

/** iPhone で「ファイルに保存」できるように渡す */
export async function saveBlob(blob, fileName) {
  const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'downloaded';
}
