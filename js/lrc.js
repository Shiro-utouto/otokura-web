// LRC 形式のパーサー（Android 版 lyrics/Lrc.kt の移植）
// - 通常の LRC: [mm:ss.xx]歌詞
// - 単語ごとのタイミング（拡張LRC / A2）: [mm:ss.xx]<mm:ss.xx>単語<mm:ss.xx>単語
// - タイムタグのないテキストはそのまま「テキストのみの歌詞」として扱う
//
// 行: { startMs, text, words: [{ startMs, text, endMs? }] | null }。startMs < 0 はタイミングなし

const LINE_TAG = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?]/;
const WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
const META_TAG = /^\[([a-zA-Z#]+):(.*)]$/;

function toMs(m) {
  const min = Number(m[1]);
  const sec = Number(m[2]);
  const frac = m[3] || '';
  let ms = 0;
  if (frac.length === 1) ms = Number(frac) * 100;
  else if (frac.length === 2) ms = Number(frac) * 10;
  else if (frac.length >= 3) ms = Number(frac.slice(0, 3));
  return min * 60000 + sec * 1000 + ms;
}

function stripWordTags(s) {
  return s.replace(WORD_TAG, '');
}

function parseWords(rest, lineStart) {
  const tags = [...rest.matchAll(WORD_TAG)];
  if (tags.length === 0) return { text: rest.trim(), words: null };
  const words = [];
  const prefix = rest.slice(0, tags[0].index);
  if (prefix.trim()) words.push({ startMs: lineStart, text: prefix });
  for (let i = 0; i < tags.length; i++) {
    const start = toMs(tags[i]);
    const segStart = tags[i].index + tags[i][0].length;
    const segEnd = i + 1 < tags.length ? tags[i + 1].index : rest.length;
    const seg = rest.slice(segStart, segEnd);
    if (seg === '') {
      // 中身のないタグは直前の単語の終了時刻
      if (words.length) words[words.length - 1] = { ...words[words.length - 1], endMs: start };
      continue;
    }
    words.push({ startMs: start, text: seg });
  }
  if (!words.length) return { text: '', words: null };
  return { text: words.map((w) => w.text).join(''), words };
}

export function parseLrc(raw) {
  let offset = 0;
  const timed = [];
  const plain = [];
  for (const rawLine of String(raw).replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      plain.push('');
      continue;
    }
    let rest = line;
    const times = [];
    for (;;) {
      const m = LINE_TAG.exec(rest);
      if (!m) break;
      times.push(toMs(m));
      rest = rest.slice(m[0].length);
    }
    if (!times.length) {
      const meta = META_TAG.exec(line);
      if (meta) {
        if (meta[1].toLowerCase() === 'offset') offset = parseInt(meta[2].trim(), 10) || 0;
        continue;
      }
      plain.push(stripWordTags(line));
      continue;
    }
    const { text, words } = parseWords(rest, times[0]);
    for (const t of times) {
      // 同じ行に複数のタイムタグがある場合（サビの繰り返し等）は単語タイミングを使わない
      timed.push({ startMs: t, text, words: times.length === 1 ? words : null });
    }
  }

  if (!timed.length) {
    let lines = plain;
    while (lines.length && !lines[0].trim()) lines = lines.slice(1);
    while (lines.length && !lines[lines.length - 1].trim()) lines = lines.slice(0, -1);
    return { lines: lines.map((t) => ({ startMs: -1, text: t, words: null })), synced: false };
  }
  const shifted = timed
    .map((l) => ({
      startMs: Math.max(0, l.startMs - offset),
      text: l.text,
      words: l.words ? l.words.map((w) => ({ ...w, startMs: w.startMs - offset, endMs: w.endMs != null ? w.endMs - offset : undefined })) : null,
    }))
    .sort((a, b) => a.startMs - b.startMs);
  return { lines: shifted, synced: true };
}

// 「作詞 : 〇〇」「Composer: 〇〇」のようなクレジットの行（LRCLIB の歌詞の先頭によく入っている）
const CREDIT_LINE =
  /^\s*(作詞・作曲|作詞\/作曲|作詞作曲|作詞曲|作曲・編曲|作編曲|作詞|作詩|作曲|編曲|詞|詩|曲|編|歌|唄|vocals?|vo\.?|lyrics?|lyricist|words|written\s+by|composers?|composed\s+by|music|arrange(ment|r|d\s+by)?|producer|produced\s+by|mix(ed\s+by)?|mastering|guitars?|bass|drums|piano|keyboards?|strings|chorus|programming)\s*[:：/／]/i;

export function isCredit(text) {
  return CREDIT_LINE.test(text);
}

/** 表示用にクレジットの行を外す（保存してある歌詞はそのまま） */
export function withoutCredits(lyrics) {
  const kept = lyrics.lines.filter((l) => !isCredit(l.text));
  if (lyrics.synced) return { ...lyrics, lines: kept };
  let i = 0;
  while (i < kept.length && !kept[i].text.trim()) i++;
  return { ...lyrics, lines: kept.slice(i) };
}

export function hasWordTiming(lyrics) {
  return lyrics.lines.some((l) => l.words && l.words.length);
}

export function formatLrcTime(ms) {
  const t = Math.max(0, Math.round(ms));
  const min = Math.floor(t / 60000);
  const sec = Math.floor((t % 60000) / 1000);
  const cs = Math.floor((t % 1000) / 10);
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** [[ms, text], ...] を LRC テキストにする */
export function buildLrc(lines) {
  return [...lines]
    .sort((a, b) => a[0] - b[0])
    .map(([t, text]) => `[${formatLrcTime(t)}]${text}`)
    .join('\n');
}

/** 歌詞の文字だけ（タイミングと情報の行を外す） */
export function plainText(raw) {
  return parseLrc(raw).lines.map((l) => l.text).join('\n');
}
