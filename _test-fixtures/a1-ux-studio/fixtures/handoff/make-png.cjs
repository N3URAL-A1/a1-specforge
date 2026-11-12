'use strict';
// Writes a tiny valid PNG of a given width (one row, 8-bit grey) so handoff cases need no binary blob.
//   node make-png.cjs <width> <out-file>
// Node core only: the CRC-32 table and the zlib deflate stand in for an image library.

const fs = require('node:fs');
const zlib = require('node:zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

function png(width) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grey
  const row = Buffer.alloc(width + 1); // filter byte 0 + zero pixels
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(row)), chunk('IEND', Buffer.alloc(0))]);
}

const width = Number(process.argv[2]);
if (!Number.isInteger(width) || width < 1 || !process.argv[3]) { process.stderr.write('usage: make-png.cjs <width> <out-file>\n'); process.exit(2); }
fs.writeFileSync(process.argv[3], png(width));
