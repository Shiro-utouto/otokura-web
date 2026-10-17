// 曲のファイルの中の情報（タグ）を読む：曲名・アーティスト・ジャケット・歌詞
// mp3（ID3v2.2〜2.4）、m4a / mp4（iTunes 形式のタグ）、FLAC（Vorbis コメント）に対応

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');

function decodeLatin1OrSjis(bytes) {
  // 日本の古い mp3 は「Latin-1」と書いてあっても中身が Shift_JIS のことが多い
  if (bytes.some((b) => b >= 0x80)) {
    try {
      return new TextDecoder('shift_jis', { fatal: true }).decode(bytes);
    } catch {
      /* Latin-1 として読む */
    }
  }
  return latin1.decode(bytes);
}

function decodeText(enc, bytes) {
  if (enc === 0) return decodeLatin1OrSjis(bytes);
  if (enc === 3) return utf8.decode(bytes);
  if (enc === 1) {
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (enc === 2) return new TextDecoder('utf-16be').decode(bytes);
  return utf8.decode(bytes);
}

/** 文字コードごとの終端（0 または 00 00）までの長さ */
function termIndex(bytes, start, enc) {
  if (enc === 1 || enc === 2) {
    for (let i = start; i + 1 < bytes.length; i += 2) if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
    return bytes.length;
  }
  for (let i = start; i < bytes.length; i++) if (bytes[i] === 0) return i;
  return bytes.length;
}

function clean(s) {
  return (s || '').replace(/\u0000/g, ' ').trim();
}

function synchsafe(b, o) {
  return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
}

function removeUnsync(b) {
  const out = [];
  for (let i = 0; i < b.length; i++) {
    out.push(b[i]);
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return new Uint8Array(out);
}

async function readBytes(blob, start, end) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

async function readId3(blob, head) {
  const ver = head[3];
  const flags = head[5];
  const size = synchsafe(head, 6);
  let tag = await readBytes(blob, 10, 10 + size);
  if (flags & 0x80 && ver < 4) tag = removeUnsync(tag);
  let pos = 0;
  if (flags & 0x40 && ver >= 3) {
    // 拡張ヘッダーは飛ばす
    const ext = ver === 4 ? synchsafe(tag, 0) : ((tag[0] << 24) | (tag[1] << 16) | (tag[2] << 8) | tag[3]) + 4;
    pos = ext;
  }
  const out = {};
  const idLen = ver === 2 ? 3 : 4;
  const hdrLen = ver === 2 ? 6 : 10;
  while (pos + hdrLen <= tag.length) {
    const id = latin1.decode(tag.subarray(pos, pos + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let fsize;
    if (ver === 2) fsize = (tag[pos + 3] << 16) | (tag[pos + 4] << 8) | tag[pos + 5];
    else if (ver === 4) fsize = synchsafe(tag, pos + 4);
    else fsize = ((tag[pos + 4] << 24) | (tag[pos + 5] << 16) | (tag[pos + 6] << 8) | tag[pos + 7]) >>> 0;
    const fflags = ver === 2 ? 0 : tag[pos + 9];
    let data = tag.subarray(pos + hdrLen, pos + hdrLen + fsize);
    pos += hdrLen + fsize;
    if (fsize <= 0) continue;
    if (ver === 4 && fflags & 0x02) data = removeUnsync(data);
    if (ver === 4 && fflags & 0x01) data = data.subarray(4); // データの長さの印
    if (ver === 4 && fflags & 0x0c) continue; // 圧縮・暗号化は読まない
    const enc = data[0];
    if (id === 'TIT2' || id === 'TT2') out.title = clean(decodeText(enc, data.subarray(1)));
    else if (id === 'TPE1' || id === 'TP1') out.artist = clean(decodeText(enc, data.subarray(1)));
    else if ((id === 'TPE2' || id === 'TP2') && !out.albumArtist) out.albumArtist = clean(decodeText(enc, data.subarray(1)));
    else if (id === 'TALB' || id === 'TAL') out.album = clean(decodeText(enc, data.subarray(1)));
    else if (id === 'TXXX' || id === 'TXX') {
      // ffmpeg などは歌詞を「TXXX:USLT」「TXXX:lyrics」に入れることがある
      const descEnd = termIndex(data, 1, enc);
      const desc = decodeText(enc, data.subarray(1, descEnd)).trim().toLowerCase();
      if (['lyrics', 'unsyncedlyrics', 'uslt'].includes(desc) && !out.lyrics) {
        out.lyrics = decodeText(enc, data.subarray(descEnd + (enc === 1 || enc === 2 ? 2 : 1))).replace(/\u0000+$/, '');
      }
    } else if (id === 'USLT' || id === 'ULT') {
      const descEnd = termIndex(data, 4, enc);
      const textStart = descEnd + (enc === 1 || enc === 2 ? 2 : 1);
      const text = decodeText(enc, data.subarray(textStart)).replace(/\u0000+$/, '');
      if (text.trim() && !out.lyrics) out.lyrics = text;
    } else if ((id === 'APIC' || id === 'PIC') && !out.picture) {
      let p = 1;
      let mime;
      if (id === 'PIC') {
        mime = latin1.decode(data.subarray(1, 4)).toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';
        p = 4;
      } else {
        const mEnd = termIndex(data, 1, 0);
        mime = latin1.decode(data.subarray(1, mEnd)) || 'image/jpeg';
        p = mEnd + 1;
      }
      p += 1; // 画像の種類
      const dEnd = termIndex(data, p, enc);
      p = dEnd + (enc === 1 || enc === 2 ? 2 : 1);
      const img = data.slice(p);
      if (img.length > 100) out.picture = new Blob([img], { type: mime.includes('/') ? mime : `image/${mime}` });
    }
  }
  return out;
}

/** mp4 の箱（atom）を順に読む */
function atoms(bytes, start, end) {
  const list = [];
  let p = start;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (p + 8 <= end) {
    let size = dv.getUint32(p);
    const type = latin1.decode(bytes.subarray(p + 4, p + 8));
    let hdr = 8;
    if (size === 1) {
      size = Number(dv.getBigUint64(p + 8));
      hdr = 16;
    } else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) break;
    list.push({ type, start: p + hdr, end: p + size });
    p += size;
  }
  return list;
}

async function findTopLevel(blob, want) {
  let p = 0;
  const found = {};
  while (p + 8 <= blob.size) {
    const h = await readBytes(blob, p, p + 16);
    const dv = new DataView(h.buffer);
    let size = dv.getUint32(0);
    const type = latin1.decode(h.subarray(4, 8));
    if (size === 1) size = Number(dv.getBigUint64(8));
    else if (size === 0) size = blob.size - p;
    if (size < 8) break;
    if (want.includes(type)) found[type] = { start: p, end: p + size };
    p += size;
  }
  return found;
}

// mp3 の長さ：Xing / Info / VBRI の印があればフレーム数から、なければビットレートから計算する
const MP3_BITRATES = {
  // [MPEG1 Layer3, MPEG2/2.5 Layer3]（kbps）
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export async function mp3DurationMs(blob, start) {
  const buf = await readBytes(blob, start, Math.min(blob.size, start + 64 * 1024));
  for (let i = 0; i + 4 < buf.length; i++) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
    const ver = (buf[i + 1] >> 3) & 3; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
    const layer = (buf[i + 1] >> 1) & 3; // 1=Layer3
    const bi = buf[i + 2] >> 4;
    const ri = (buf[i + 2] >> 2) & 3;
    if (ver === 1 || layer !== 1 || bi === 0 || bi === 15 || ri === 3) continue;
    const kbps = MP3_BITRATES[ver === 3 ? 1 : 2][bi];
    const rate = MP3_RATES[ver][ri];
    const mono = (buf[i + 3] >> 6) === 3;
    const samples = ver === 3 ? 1152 : 576;
    const side = ver === 3 ? (mono ? 17 : 32) : mono ? 9 : 17;
    const x = i + 4 + side;
    const tag = latin1.decode(buf.subarray(x, x + 4));
    if ((tag === 'Xing' || tag === 'Info') && buf[x + 7] & 1) {
      const frames = new DataView(buf.buffer, buf.byteOffset + x + 8, 4).getUint32(0);
      if (frames > 0) return Math.round((frames * samples * 1000) / rate);
    }
    if (latin1.decode(buf.subarray(i + 36, i + 40)) === 'VBRI') {
      const frames = new DataView(buf.buffer, buf.byteOffset + i + 50, 4).getUint32(0);
      if (frames > 0) return Math.round((frames * samples * 1000) / rate);
    }
    return Math.round(((blob.size - start - i) * 8) / kbps);
  }
  return 0;
}

async function readMp4(blob) {
  const { moov } = await findTopLevel(blob, ['moov']);
  if (!moov) return {};
  const bytes = await readBytes(blob, moov.start, moov.end);
  const out = { hasVideo: false };
  const top = atoms(bytes, 8, bytes.length);
  // 曲の長さ（mvhd）。再生の仕組みで長さを取れないときの予備
  const mvhd = top.find((a) => a.type === 'mvhd');
  if (mvhd) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset + mvhd.start);
    const v1 = bytes[mvhd.start] === 1;
    const scale = dv.getUint32(v1 ? 20 : 12);
    const dur = v1 ? Number(dv.getBigUint64(24)) : dv.getUint32(16);
    if (scale > 0 && dur > 0) out.durationMs = Math.round((dur / scale) * 1000);
  }
  // 映像の入れ物か（trak の hdlr が vide）
  for (const trak of top.filter((a) => a.type === 'trak')) {
    const mdia = atoms(bytes, trak.start, trak.end).find((a) => a.type === 'mdia');
    if (!mdia) continue;
    const hdlr = atoms(bytes, mdia.start, mdia.end).find((a) => a.type === 'hdlr');
    if (hdlr && latin1.decode(bytes.subarray(hdlr.start + 8, hdlr.start + 12)) === 'vide') out.hasVideo = true;
  }
  const udta = top.find((a) => a.type === 'udta');
  if (!udta) return out;
  const meta = atoms(bytes, udta.start, udta.end).find((a) => a.type === 'meta');
  if (!meta) return out;
  const ilst = atoms(bytes, meta.start + 4, meta.end).find((a) => a.type === 'ilst');
  if (!ilst) return out;
  for (const item of atoms(bytes, ilst.start, ilst.end)) {
    const data = atoms(bytes, item.start, item.end).find((a) => a.type === 'data');
    if (!data) continue;
    const kind = new DataView(bytes.buffer, bytes.byteOffset + data.start, 4).getUint32(0) & 0xffffff;
    const value = bytes.subarray(data.start + 8, data.end);
    const text = () => clean(utf8.decode(value));
    switch (item.type) {
      case '©nam':
        out.title = text();
        break;
      case '©ART':
        out.artist = text();
        break;
      case 'aART':
        out.albumArtist = text();
        break;
      case '©alb':
        out.album = text();
        break;
      case '©lyr':
        out.lyrics = utf8.decode(value);
        break;
      case 'covr':
        if (value.length > 100) out.picture = new Blob([value.slice()], { type: kind === 14 ? 'image/png' : 'image/jpeg' });
        break;
      default:
    }
  }
  return out;
}

async function readFlac(blob) {
  const out = {};
  let p = 4;
  for (let n = 0; n < 64 && p + 4 <= blob.size; n++) {
    const h = await readBytes(blob, p, p + 4);
    const last = h[0] & 0x80;
    const type = h[0] & 0x7f;
    const len = (h[1] << 16) | (h[2] << 8) | h[3];
    if (type === 4 || (type === 6 && !out.picture)) {
      const b = await readBytes(blob, p + 4, p + 4 + len);
      const dv = new DataView(b.buffer);
      if (type === 4) {
        let q = 4 + dv.getUint32(0, true);
        const count = dv.getUint32(q, true);
        q += 4;
        for (let i = 0; i < count && q + 4 <= b.length; i++) {
          const l = dv.getUint32(q, true);
          const s = utf8.decode(b.subarray(q + 4, q + 4 + l));
          q += 4 + l;
          const eq = s.indexOf('=');
          const k = s.slice(0, eq).toUpperCase();
          const v = s.slice(eq + 1);
          if (k === 'TITLE') out.title = clean(v);
          else if (k === 'ARTIST' && !out.artist) out.artist = clean(v);
          else if (k === 'ALBUMARTIST') out.albumArtist = clean(v);
          else if (k === 'ALBUM') out.album = clean(v);
          else if ((k === 'LYRICS' || k === 'UNSYNCEDLYRICS') && !out.lyrics) out.lyrics = v;
        }
      } else {
        let q = 4;
        const ml = dv.getUint32(q);
        const mime = latin1.decode(b.subarray(q + 4, q + 4 + ml));
        q += 4 + ml;
        q += 4 + dv.getUint32(q) + 16;
        const dl = dv.getUint32(q);
        out.picture = new Blob([b.slice(q + 4, q + 4 + dl)], { type: mime || 'image/jpeg' });
      }
    }
    p += 4 + len;
    if (last) break;
  }
  return out;
}

/**
 * @returns {Promise<{title?, artist?, albumArtist?, album?, lyrics?, picture?: Blob, hasVideo?: boolean}>}
 */
export async function readTags(blob) {
  try {
    const head = await readBytes(blob, 0, 12);
    const sig = latin1.decode(head.subarray(0, 4));
    if (sig.startsWith('ID3')) {
      const out = await readId3(blob, head);
      out.durationMs = await mp3DurationMs(blob, 10 + synchsafe(head, 6) + (head[5] & 0x10 ? 10 : 0));
      return out;
    }
    if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return { durationMs: await mp3DurationMs(blob, 0) };
    if (sig === 'fLaC') return await readFlac(blob);
    if (latin1.decode(head.subarray(4, 8)) === 'ftyp') return await readMp4(blob);
  } catch (e) {
    console.warn('タグを読めませんでした', e);
  }
  return {};
}
