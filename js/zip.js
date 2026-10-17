// zip の読み書き（バックアップ用）
// 書き込みは「圧縮なし」だけ（曲や画像はもともと圧縮されているため）。読み込みは圧縮なしと deflate に対応

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, crc = 0) {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function crcOfBlob(blob) {
  let crc = 0;
  const CHUNK = 4 * 1024 * 1024;
  for (let p = 0; p < blob.size; p += CHUNK) {
    crc = crc32(new Uint8Array(await blob.slice(p, p + CHUNK).arrayBuffer()), crc);
  }
  return crc;
}

function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/** 書き込み。add() で順に足し、finish() で Blob にする（中身は Blob のつなぎ合わせなので、大きくてもメモリーを使わない） */
export class ZipWriter {
  constructor() {
    this.parts = [];
    this.central = [];
    this.offset = 0;
    this.enc = new TextEncoder();
    this.when = dosTime(new Date());
  }

  /** @param {string} name @param {Blob|string} data */
  async add(name, data) {
    const blob = typeof data === 'string' ? new Blob([data], { type: 'application/json' }) : data;
    const nameBytes = this.enc.encode(name);
    const crc = await crcOfBlob(blob);
    const size = blob.size;
    if (this.offset + size > 0xfffffff0) throw new Error('バックアップが大きすぎます（4 GB まで）。曲のファイルを含めずに作ってください。');
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // 名前は UTF-8
    local.setUint16(8, 0, true); // 圧縮なし
    local.setUint16(10, this.when.time, true);
    local.setUint16(12, this.when.day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    this.parts.push(local.buffer, nameBytes, blob);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, this.when.time, true);
    cen.setUint16(14, this.when.day, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, size, true);
    cen.setUint32(24, size, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint32(42, this.offset, true);
    this.central.push(cen.buffer, nameBytes);
    this.offset += 30 + nameBytes.length + size;
    this.count = (this.count || 0) + 1;
  }

  finish() {
    const cenSize = this.central.reduce((n, p) => n + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.count || 0, true);
    end.setUint16(10, this.count || 0, true);
    end.setUint32(12, cenSize, true);
    end.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.central, end.buffer], { type: 'application/zip' });
  }
}

/** 読み込み。中身の一覧（名前・取り出す関数） */
export async function readZip(blob) {
  const tailLen = Math.min(blob.size, 65557);
  const tail = new Uint8Array(await blob.slice(blob.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip ファイルとして読めません');
  const ev = new DataView(tail.buffer, eocd);
  const count = ev.getUint16(10, true);
  const cenSize = ev.getUint32(12, true);
  const cenOff = ev.getUint32(16, true);
  if (cenOff === 0xffffffff || count === 0xffff) throw new Error('この zip の形式（ZIP64）には対応していません');
  const cen = new Uint8Array(await blob.slice(cenOff, cenOff + cenSize).arrayBuffer());
  const dv = new DataView(cen.buffer);
  const dec = new TextDecoder('utf-8');
  const entries = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cen.length; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(cen.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    entries.push({
      name,
      size: usize,
      isDir: name.endsWith('/'),
      async blob(type = '') {
        const lh = new DataView(await blob.slice(off, off + 30).arrayBuffer());
        if (lh.getUint32(0, true) !== 0x04034b50) throw new Error(`${name} を読めません`);
        const start = off + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
        const raw = blob.slice(start, start + csize);
        if (method === 0) return raw.slice(0, raw.size, type);
        if (method === 8) {
          const stream = raw.stream().pipeThrough(new DecompressionStream('deflate-raw'));
          const out = await new Response(stream).blob();
          return out.slice(0, out.size, type);
        }
        throw new Error(`${name} の圧縮形式（${method}）には対応していません`);
      },
      async text() {
        return (await this.blob()).text();
      },
    });
  }
  return entries;
}
