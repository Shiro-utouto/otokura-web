// mp4 の動画から音声だけを取り出して m4a にする（音は変換しないので、音質はそのまま・一瞬で終わる）
//
// yt-dlp で取った 1080p の mp4 は、映像が AV1 や VP9 のことが多い。古い iPhone はそれを再生できず、
// 音声（AAC）まで再生できなくなる。音声だけの m4a にすれば必ず再生でき、容量も数十分の1になる。
//
// やり方：moov の中の音声のトラックだけを残し、音声のデータ（チャンク）を mdat に順に並べ直して、
// チャンクの位置（stco / co64）だけを書き換える。サンプルの表（stsz・stsc・stts）はそのまま使える

const latin1 = new TextDecoder('latin1');

async function bytesOf(blob, start, end) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

/** 箱（atom）の一覧 */
function boxes(b, start, end) {
  const out = [];
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = start;
  while (p + 8 <= end) {
    let size = dv.getUint32(p);
    const type = latin1.decode(b.subarray(p + 4, p + 8));
    let hdr = 8;
    if (size === 1) {
      size = Number(dv.getBigUint64(p + 8));
      hdr = 16;
    } else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) break;
    out.push({ type, pos: p, start: p + hdr, end: p + size });
    p += size;
  }
  return out;
}

const child = (b, box, type, skip = 0) => boxes(b, box.start + skip, box.end).find((x) => x.type === type);

async function topLevel(blob) {
  const list = [];
  let p = 0;
  while (p + 8 <= blob.size) {
    const h = await bytesOf(blob, p, Math.min(blob.size, p + 16));
    const dv = new DataView(h.buffer);
    let size = dv.getUint32(0);
    const type = latin1.decode(h.subarray(4, 8));
    if (size === 1) size = Number(dv.getBigUint64(8));
    else if (size === 0) size = blob.size - p;
    if (size < 8) break;
    list.push({ type, start: p, end: p + size });
    p += size;
  }
  return list;
}

/** 音声のトラックの形式（mp4a = AAC、Opus、alac など）。音声がなければ null */
export async function audioCodecOf(blob) {
  try {
    const moovBox = (await topLevel(blob)).find((x) => x.type === 'moov');
    if (!moovBox) return null;
    const moov = await bytesOf(blob, moovBox.start, moovBox.end);
    for (const trak of boxes(moov, 8, moov.length).filter((x) => x.type === 'trak')) {
      const mdia = child(moov, trak, 'mdia');
      const hdlr = mdia && child(moov, mdia, 'hdlr');
      if (!hdlr || latin1.decode(moov.subarray(hdlr.start + 8, hdlr.start + 12)) !== 'soun') continue;
      const stsd = child(moov, child(moov, child(moov, mdia, 'minf'), 'stbl'), 'stsd');
      return latin1.decode(moov.subarray(stsd.start + 12, stsd.start + 16));
    }
  } catch {
    /* 読めない */
  }
  return null;
}

/**
 * @returns {Promise<Blob>} 音声だけの m4a
 * @throws 音声がない・AAC 以外・分割された mp4 など、取り出せないとき（message は日本語）
 */
export async function extractAudioM4a(blob) {
  const top = await topLevel(blob);
  const moovBox = top.find((x) => x.type === 'moov');
  if (!moovBox) throw new Error('mp4 の情報（moov）が見つかりません');
  if (top.some((x) => x.type === 'moof')) throw new Error('分割された形式の mp4 には対応していません');
  const moov = await bytesOf(blob, moovBox.start, moovBox.end);
  const items = boxes(moov, 8, moov.length);
  const mvhd = items.find((x) => x.type === 'mvhd');
  const udta = items.find((x) => x.type === 'udta');

  let audio = null;
  for (const trak of items.filter((x) => x.type === 'trak')) {
    const mdia = child(moov, trak, 'mdia');
    const hdlr = mdia && child(moov, mdia, 'hdlr');
    if (hdlr && latin1.decode(moov.subarray(hdlr.start + 8, hdlr.start + 12)) === 'soun') {
      audio = { trak, mdia };
      break;
    }
  }
  if (!audio) throw new Error('この動画には音声が入っていません');
  const stbl = child(moov, child(moov, audio.mdia, 'minf'), 'stbl');
  const stsd = child(moov, stbl, 'stsd');
  const codec = latin1.decode(moov.subarray(stsd.start + 12, stsd.start + 16));
  if (codec !== 'mp4a') throw new Error(`音声の形式（${codec.trim()}）が AAC ではないので取り出せません`);

  const dv = new DataView(moov.buffer);
  // サンプルの大きさ
  const stsz = child(moov, stbl, 'stsz');
  const fixedSize = dv.getUint32(stsz.start + 4);
  const sampleCount = dv.getUint32(stsz.start + 8);
  const sizeOf = (i) => (fixedSize ? fixedSize : dv.getUint32(stsz.start + 12 + i * 4));
  // チャンクの位置
  const stco = child(moov, stbl, 'stco') || child(moov, stbl, 'co64');
  const is64 = stco.type === 'co64';
  const chunkCount = dv.getUint32(stco.start + 4);
  const offsetOf = (c) => (is64 ? Number(dv.getBigUint64(stco.start + 8 + c * 8)) : dv.getUint32(stco.start + 8 + c * 4));
  // チャンクごとのサンプル数（stsc）
  const stsc = child(moov, stbl, 'stsc');
  const entries = dv.getUint32(stsc.start + 4);
  const runs = [];
  for (let i = 0; i < entries; i++) {
    const o = stsc.start + 8 + i * 12;
    runs.push({ first: dv.getUint32(o) - 1, per: dv.getUint32(o + 4) });
  }
  const chunks = [];
  let sample = 0;
  for (let c = 0; c < chunkCount; c++) {
    let per = 0;
    for (const r of runs) if (r.first <= c) per = r.per;
    let bytes = 0;
    for (let k = 0; k < per && sample < sampleCount; k++) bytes += sizeOf(sample++);
    chunks.push({ offset: offsetOf(c), bytes });
  }

  // 新しい moov：mvhd ＋ 音声のトラック ＋ udta（曲名やジャケットのタグ）
  const parts = [mvhd, audio.trak, udta].filter(Boolean);
  const bodyLen = parts.reduce((n, p) => n + (p.end - p.pos), 0);
  const newMoov = new Uint8Array(8 + bodyLen);
  const mdv = new DataView(newMoov.buffer);
  mdv.setUint32(0, newMoov.length);
  newMoov.set([0x6d, 0x6f, 0x6f, 0x76], 4); // moov
  let w = 8;
  let stcoAt = -1;
  for (const p of parts) {
    newMoov.set(moov.subarray(p.pos, p.end), w);
    if (p === audio.trak) stcoAt = w + (stco.start - p.pos);
    w += p.end - p.pos;
  }

  const ftyp = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0, 0x4d, 0x34, 0x41, 0x20, 0x69, 0x73, 0x6f, 0x6d]); // ftyp M4A / isom
  const total = chunks.reduce((n, c) => n + c.bytes, 0);
  const mdatHdr = new Uint8Array(8);
  new DataView(mdatHdr.buffer).setUint32(0, total + 8);
  mdatHdr.set([0x6d, 0x64, 0x61, 0x74], 4); // mdat

  // チャンクの新しい位置を書き込む
  let pos = ftyp.length + newMoov.length + 8;
  chunks.forEach((c, i) => {
    if (is64) mdv.setBigUint64(stcoAt + 8 + i * 8, BigInt(pos));
    else mdv.setUint32(stcoAt + 8 + i * 4, pos);
    pos += c.bytes;
  });

  // 隣り合うチャンクはまとめて切り出す
  const slices = [];
  for (const c of chunks) {
    const last = slices[slices.length - 1];
    if (last && last.end === c.offset) last.end += c.bytes;
    else slices.push({ start: c.offset, end: c.offset + c.bytes });
  }
  return new Blob([ftyp, newMoov, mdatHdr, ...slices.map((s) => blob.slice(s.start, s.end))], { type: 'audio/mp4' });
}
