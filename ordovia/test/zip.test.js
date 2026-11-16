// The ZIP the export is made of: written in a stream, read back, checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipStream, readZip, crc32 } from '../src/zip.js';
import { toCsv } from '../src/backup.js';

const collect = async (readable) => new Uint8Array(await new Response(readable).arrayBuffer());

test('crc32 of a known text', () => { assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926); });

test('a zip written as a stream reads back exactly', async () => {
  const z = zipStream();
  const big = new Uint8Array(200000).map((_, i) => (i * 7) % 256);
  const done = (async () => {
    await z.add('README.txt', 'héllo – wörld');
    await z.add('registers/leveranciers.csv', 'a;b\r\n1;2\r\n');
    await z.add('bestanden/1-foto ä.png', big);
    await z.add('leeg.txt', '');
    await z.finish();
  })();
  const bytes = await collect(z.readable); await done;
  const files = await readZip(bytes);
  assert.deepEqual(files.map(f => f.name), ['README.txt', 'registers/leveranciers.csv', 'bestanden/1-foto ä.png', 'leeg.txt']);
  assert.equal(new TextDecoder().decode(files[0].data), 'héllo – wörld');
  assert.deepEqual([...files[2].data.slice(0, 5)], [...big.slice(0, 5)]);
  assert.equal(files[2].data.length, 200000); assert.equal(files[3].data.length, 0);
});

test('a damaged zip is refused', async () => {
  const z = zipStream(); const done = (async () => { await z.add('a.txt', 'abcdef'); await z.finish(); })();
  const bytes = await collect(z.readable); await done;
  bytes[40] ^= 0xff;   // flip a byte inside the file data
  await assert.rejects(() => readZip(bytes), /Damaged/);
  await assert.rejects(() => readZip(new Uint8Array([1, 2, 3])), /not a ZIP/);
});

test('a deflated zip (made by another program) can be read too', async () => {
  const raw = new TextEncoder().encode('Ordovia '.repeat(500));
  const deflated = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const nm = new TextEncoder().encode('x.txt'), crc = crc32(raw);
  const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(8, 8, true); lh.setUint32(14, crc, true); lh.setUint32(18, deflated.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, nm.length, true);
  const cd = new DataView(new ArrayBuffer(46)); cd.setUint32(0, 0x02014b50, true); cd.setUint16(10, 8, true); cd.setUint32(16, crc, true); cd.setUint32(20, deflated.length, true); cd.setUint32(24, raw.length, true); cd.setUint16(28, nm.length, true);
  const start = 30 + nm.length + deflated.length;
  const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true); end.setUint32(12, 46 + nm.length, true); end.setUint32(16, start, true);
  const all = new Uint8Array([...new Uint8Array(lh.buffer), ...nm, ...deflated, ...new Uint8Array(cd.buffer), ...nm, ...new Uint8Array(end.buffer)]);
  const [f] = await readZip(all);
  assert.equal(f.name, 'x.txt'); assert.equal(new TextDecoder().decode(f.data), 'Ordovia '.repeat(500));
});

test('csv for Excel: BOM, quotes, the separator of the language', () => {
  assert.equal(toCsv(['naam', 'bedrag'], [['Jan "de" Man', 1.5], ['a;b', null]], ';'), '﻿naam;bedrag\r\n"Jan ""de"" Man";1.5\r\n"a;b";\r\n');
  assert.equal(toCsv(['a'], [['x,y']], ','), '﻿a\r\n"x,y"\r\n');
});
