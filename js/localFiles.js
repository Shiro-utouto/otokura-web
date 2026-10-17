// ファイルの判定と、ファイル名・タグからの曲名の推測（Android 版 data/LocalFiles.kt を元に、
// ダウンロードサイトのファイル名の付け方にも対応）
import { guess } from './titleCleaner.js';

const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wav', 'caf', 'aif', 'aiff', 'alac']);
const VIDEO_EXT = new Set(['mp4', 'm4v', 'mov', 'webm']);
const LYRICS_EXT = new Set(['lrc', 'txt']);

export function extensionOf(name) {
  const i = name.lastIndexOf('.');
  if (i < 0) return '';
  const ext = name.slice(i + 1).toLowerCase();
  return ext && ext.length <= 5 ? ext : '';
}

export function baseName(name) {
  return extensionOf(name) ? name.slice(0, name.lastIndexOf('.')) : name;
}

export function isMediaFile(name, mime = '') {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('audio/') || m.startsWith('video/')) return true;
  const ext = extensionOf(name);
  return AUDIO_EXT.has(ext) || VIDEO_EXT.has(ext);
}

export function isLyricsFile(name) {
  return LYRICS_EXT.has(extensionOf(name));
}

export function isZipFile(name, mime = '') {
  return extensionOf(name) === 'zip' || /zip/.test(mime || '');
}

export function isVideoName(name) {
  return VIDEO_EXT.has(extensionOf(name));
}

// 先頭のトラック番号（「01 」「1. 」「1-02 」「3 - 」）。「7 Rings」のような1桁と空白だけは曲名の一部として残す
const TRACK_NUMBER = /^\s*(?:\d{1,2}-)?(?:\d{2,3}(?:\s*[.．_]\s*|\s+-\s+|\s+)|\d(?:\s*[.．]\s*|\s+-\s+))/u;
const SEPARATORS = [' - ', ' – ', ' — ', ' ‐ '];

/**
 * タグに曲名がないとき、ファイル名から曲名とアーティストを推測する（Android 版と同じ動き）。
 * 「01 曲名.mp3」→ [曲名, ""]、「アーティスト - 曲名.flac」→ [曲名, アーティスト]
 */
export function guessFromFileName(name) {
  let s = baseName(name).trim();
  if (!s.includes(' ') && s.includes('_')) s = s.replaceAll('_', ' ');
  const withoutNumber = s.replace(TRACK_NUMBER, '').trim();
  if (withoutNumber) s = withoutNumber;
  for (const sep of SEPARATORS) {
    const i = s.indexOf(sep);
    if (i > 0) {
      const artist = s.slice(0, i).trim();
      const title = s.slice(i + sep.length).trim();
      if (artist && title) return [title, artist];
    }
  }
  return [s, ''];
}

// ダウンロードサイトがファイル名に付ける飾り
const SITE_PREFIX = /^\s*(?:[\w-]+\.)+(?:com|net|org|io|is|nu|cc|ch|app|to|sx|lt|mov|me|tv|co|cx|ws|xyz|site|online|info|biz|pro|one)\s*[-_–—|]\s*/iu;
const SITE_SUFFIX = /\s*[-_–—|]?\s*(?:[\w-]+\.)+(?:com|net|org|io|is|nu|cc|ch|app|to|sx|lt|mov|me|tv|co|cx|ws|xyz|site|online|info|biz|pro|one)\s*$/iu;
const BITRATE = /[\s_-]*(?:\(\s*)?\d{2,3}\s*k(?:bps)?(?:\s*\))?\s*$/iu;
const QUALITY = /[\s_-]*(?:\(\s*)?(?:\d{3,4}p(?:\d{2})?|hq|hd)(?:\s*\))?\s*$/iu;

/** ダウンロードサイトのファイル名から、元の動画タイトルを取り出す */
export function stripDownloaderNoise(name) {
  let s = name.trim();
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(SITE_PREFIX, '').replace(SITE_SUFFIX, '').replace(BITRATE, '').replace(QUALITY, '');
    // 「[y2mate.com]」「(ytmp3.cc)」のようにかっこで囲んだサイト名
    s = s.replace(/\s*[\[(（【]\s*(?:[\w-]+\.)+[a-z]{2,6}\s*[\])）】]\s*/giu, ' ').trim();
    if (s === before) break;
  }
  return s || name.trim();
}

/** 動画タイトルに見える（飾りやかっこ、区切りがある） */
function looksLikeVideoTitle(s) {
  return /[「『【\[(（]|\s[-–—|]\s|\s\/\s|／|official|\bmv\b|\bpv\b|music\s*video|lyric/iu.test(s);
}

function looksLikeDomain(s) {
  return /^(?:[\w-]+\.)+[a-z]{2,6}$/iu.test(s.trim());
}

/**
 * 取り込むファイルの曲名とアーティストを決める。
 * 1. タグに曲名とアーティストがあり、動画タイトルらしくなければ、そのまま（いちばん確か）
 * 2. タグの曲名が動画タイトルらしければ、タグのアーティストをチャンネル名として推測する
 * 3. タグがなければファイル名から推測する（ダウンロードサイトの飾りを外してから）
 * @returns {[string, string]}
 */
export function decideTitleArtist(fileName, tagTitle, tagArtist) {
  const tTitle = (tagTitle || '').trim();
  let tArtist = (tagArtist || '').trim();
  if (looksLikeDomain(tArtist)) tArtist = '';
  if (tTitle) {
    if (tArtist && !looksLikeVideoTitle(tTitle)) return [tTitle, tArtist];
    const [t, a] = guess(stripDownloaderNoise(tTitle), tArtist, false);
    return [t || tTitle, a];
  }
  let s = stripDownloaderNoise(baseName(fileName));
  if (!s.includes(' ') && s.includes('_')) s = s.replaceAll('_', ' ');
  if (looksLikeVideoTitle(s)) {
    const [t, a] = guess(s, '', false);
    if (t) return [t, a];
  }
  return guessFromFileName(s);
}

export function formatBytes(bytes) {
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < mb) return `${Math.max(1, Math.round(bytes / kb))} KB`;
  if (bytes < gb) return `${(bytes / mb).toFixed(1)} MB`;
  return `${(bytes / gb).toFixed(1)} GB`;
}

export function formatDuration(ms) {
  if (!ms || ms < 0 || !isFinite(ms)) return '0:00';
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
