// ジャケット画像：縮小、動画の1コマ、背景のグラデーション用の色

/** 長い辺を max px にした JPEG（大きすぎる画像で容量を使わないため） */
export async function resizeImage(blob, max = 600) {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    return await new Promise((r) => c.toBlob((b) => r(b), 'image/jpeg', 0.86));
  } catch {
    return null;
  }
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

/**
 * ジャケットから背景用の色を3つ作る（暗めにして、白い文字が読めるようにする）
 * @returns {Promise<string[]|null>}
 */
export async function extractColors(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const N = 32;
    const c = document.createElement('canvas');
    c.width = N;
    c.height = N;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, N, N);
    bmp.close?.();
    const d = ctx.getImageData(0, 0, N, N).data;
    const buckets = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      const key = s < 0.12 ? `g${Math.round(l * 4)}` : `${Math.round(h / 24)}:${Math.round(l * 3)}`;
      const b = buckets.get(key) || { n: 0, h: 0, s: 0, l: 0, hx: 0, hy: 0 };
      b.n++;
      b.hx += Math.cos((h * Math.PI) / 180);
      b.hy += Math.sin((h * Math.PI) / 180);
      b.s += s;
      b.l += l;
      buckets.set(key, b);
    }
    const list = [...buckets.values()]
      .map((b) => {
        const h = ((Math.atan2(b.hy, b.hx) * 180) / Math.PI + 360) % 360;
        const s = b.s / b.n;
        const l = b.l / b.n;
        return { h, s, l, score: b.n * (0.35 + s) };
      })
      .sort((a, b) => b.score - a.score);
    const picked = [];
    for (const col of list) {
      if (picked.every((p) => Math.abs(p.h - col.h) > 25 || Math.abs(p.l - col.l) > 0.2 || Math.abs(p.s - col.s) > 0.3)) picked.push(col);
      if (picked.length === 3) break;
    }
    while (picked.length < 3) picked.push(picked[picked.length - 1] || { h: 220, s: 0.2, l: 0.3 });
    return picked.map((p, i) => hslToHex(p.h, Math.min(0.75, p.s * 1.1), Math.min(0.42, Math.max(0.12, p.l * 0.75)) - i * 0.03));
  } catch {
    return null;
  }
}

/** 曲名から決まる色（ジャケットがない曲用） */
export function fallbackColors(seed) {
  let h = 0;
  for (const ch of seed || '') h = (h * 31 + ch.codePointAt(0)) % 360;
  return [hslToHex(h, 0.45, 0.32), hslToHex((h + 40) % 360, 0.5, 0.22), hslToHex((h + 300) % 360, 0.4, 0.16)];
}

/**
 * 曲のファイルの長さ・映像の有無を調べ、映像があれば1コマをジャケットにする
 * @returns {Promise<{ durationMs: number, hasVideo: boolean, frame: Blob|null }>}
 */
export function probeMedia(blob, wantFrame) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    let done = false;
    const result = { durationMs: 0, hasVideo: false, frame: null };
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
      resolve(result);
    };
    // iPhone では、再生するまで読み込まないことがあるので長くは待たない（長さはタグからも取る）
    const timer = setTimeout(finish, 5000);
    v.onerror = finish;
    v.onloadedmetadata = () => {
      if (isFinite(v.duration)) result.durationMs = Math.round(v.duration * 1000);
      result.hasVideo = v.videoWidth > 0 && v.videoHeight > 0;
      if (!result.hasVideo || !wantFrame) return finish();
      v.currentTime = Math.min(v.duration * 0.15 || 1, 8);
    };
    v.onseeked = async () => {
      try {
        const c = document.createElement('canvas');
        const scale = Math.min(1, 600 / Math.max(v.videoWidth, v.videoHeight));
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        result.frame = await new Promise((r) => c.toBlob((b) => r(b), 'image/jpeg', 0.85));
      } catch {
        /* 1コマを取れなくても続ける */
      }
      finish();
    };
    v.src = url;
  });
}
