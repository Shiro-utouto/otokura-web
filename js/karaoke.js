// カラオケ風ハイライトの計算（Android 版 lyrics/Karaoke.kt の移植）
// 行の中で「何文字目まで塗るか」を返す（小数は文字の途中まで）

const PUNCT = '、。！？「」『』（）・…ー〜';
const MS_PER_WEIGHT = 330;

function isLetterOrDigit(c) {
  return /[\p{L}\p{N}]/u.test(c);
}

/** 歌うのにかかる時間の重み（かな・漢字=1、英字は短め） */
function weight(c) {
  const code = c.codePointAt(0);
  if (/\s/.test(c)) return 0.25;
  if (code < 0x3000 && isLetterOrDigit(c)) return 0.35;
  if (code < 0x3000) return 0.15;
  if (PUNCT.includes(c)) return 0.3;
  return 1;
}

/** 文字の配列（サロゲートペアを1文字として数える） */
export function chars(text) {
  return Array.from(text);
}

export function litChars(line, nextStartMs, posMs) {
  const cs = chars(line.text);
  if (!cs.length || posMs < line.startMs) return 0;

  const words = line.words;
  if (words && words.length) {
    let acc = 0;
    for (let k = 0; k < words.length; k++) {
      const w = words[k];
      const len = chars(w.text).length;
      const end =
        w.endMs != null
          ? w.endMs
          : k + 1 < words.length
            ? words[k + 1].startMs
            : nextStartMs != null
              ? Math.min(nextStartMs, w.startMs + 3000)
              : w.startMs + 1000;
      if (posMs < w.startMs) return acc;
      if (posMs < end) {
        const f = (posMs - w.startMs) / Math.max(1, end - w.startMs);
        return acc + f * len;
      }
      acc += len;
    }
    return cs.length;
  }

  // 行単位のタイミングしかない場合は、文字数から歌う速さを推定する
  let total = 0;
  for (const c of cs) total += weight(c);
  if (total <= 0) return cs.length;
  const estimated = total * MS_PER_WEIGHT + 400;
  const gap = nextStartMs != null && nextStartMs > line.startMs ? nextStartMs - line.startMs : estimated;
  const duration = Math.max(300, Math.min(estimated, gap * 0.92));
  const target = ((posMs - line.startMs) / duration) * total;
  if (target >= total) return cs.length;
  let accW = 0;
  for (let i = 0; i < cs.length; i++) {
    const w = weight(cs[i]);
    if (accW + w >= target) return i + (target - accW) / w;
    accW += w;
  }
  return cs.length;
}

/** 再生位置に対応する行の番号（最初の行より前なら -1） */
export function currentIndex(lines, posMs) {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].startMs <= posMs) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
