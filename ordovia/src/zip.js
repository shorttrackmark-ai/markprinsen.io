// A small ZIP writer (streaming, no compression) and reader (stored or deflated). No dependencies, works in the Worker and in Node.
const enc = new TextEncoder();
let CRC = null;
function crcTable() {
  if (CRC) return CRC;
  CRC = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
  return CRC;
}
export function crc32(u8) {
  const t = crcTable(); let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = t[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const dosTime = (d) => ((d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1)) & 0xffff;
const dosDate = (d) => ((((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate()) & 0xffff);

/** Entries are written one after the other as they are added, so memory only ever holds one file. */
export function zipStream() {
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  const entries = []; let offset = 0;
  const put = async (u8) => { await w.write(u8); offset += u8.length; };
  return {
    readable,
    async add(name, data, date = new Date()) {
      const body = typeof data === 'string' ? enc.encode(data) : data, nm = enc.encode(name), crc = crc32(body);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dosTime(date), true); h.setUint16(12, dosDate(date), true); h.setUint32(14, crc, true);
      h.setUint32(18, body.length, true); h.setUint32(22, body.length, true); h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
      entries.push({ nm, crc, size: body.length, offset, time: dosTime(date), date: dosDate(date) });
      await put(new Uint8Array(h.buffer)); await put(nm); if (body.length) await put(body);
    },
    async finish() {
      const start = offset;
      for (const e of entries) {
        const h = new DataView(new ArrayBuffer(46));
        h.setUint32(0, 0x02014b50, true); h.setUint16(4, 20, true); h.setUint16(6, 20, true); h.setUint16(8, 0x0800, true); h.setUint16(10, 0, true);
        h.setUint16(12, e.time, true); h.setUint16(14, e.date, true); h.setUint32(16, e.crc, true); h.setUint32(20, e.size, true); h.setUint32(24, e.size, true);
        h.setUint16(28, e.nm.length, true); h.setUint32(42, e.offset, true);
        await put(new Uint8Array(h.buffer)); await put(e.nm);
      }
      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
      end.setUint32(12, offset - start, true); end.setUint32(16, start, true);
      await put(new Uint8Array(end.buffer));
      await w.close();
    },
    abort(e) { return w.abort(e); },
  };
}

/** Read a whole ZIP held in memory. Returns [{name, data: Uint8Array}] (stored and deflated entries). */
export async function readZip(u8) {
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let end = -1;
  for (let i = u8.length - 22; i >= 0; i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('This is not a ZIP file');
  const count = v.getUint16(end + 10, true); let p = v.getUint32(end + 16, true);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged ZIP file');
    const method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), csize = v.getUint32(p + 20, true);
    const nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl));
    const ln = v.getUint16(lo + 26, true), le = v.getUint16(lo + 28, true), at = lo + 30 + ln + le;
    let data = u8.subarray(at, at + csize);
    if (method === 8) data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else if (method !== 0) throw new Error('Unsupported ZIP compression');
    if (crc32(data) !== crc) throw new Error('Damaged ZIP file: ' + name);
    out.push({ name, data });
    p += 46 + nl + el + cl;
  }
  return out;
}
