// A small ZIP writer: deflate entries, UTF-8 names and a normal central
// directory. It intentionally supports only the two methods this app creates
// (deflate and store) and rejects paths that could escape an archive.

import { deflateRawSync } from 'node:zlib';

const ZIP_MAX_FILES = 5_000;
const ZIP_MAX_BYTES = 64 * 1024 * 1024;
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let k = 0; k < 8; k += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
})();

function zipBad(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function dosStamp(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function safeZipPath(value) {
  const path = String(value ?? '').replaceAll('\\', '/').replace(/^\/+/, '');
  if (!path || path.length > 300 || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw zipBad('Archive paths must be simple relative file paths.');
  }
  return path;
}

/**
 * Build a ZIP from [{ path, data }]. Files are deflated; a small file that
 * grows under compression falls back to STORE. Limits are checked before any
 * buffer is allocated.
 */
export function createZip(entries, { maxFiles = ZIP_MAX_FILES, maxBytes = ZIP_MAX_BYTES } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) throw zipBad('The archive has no files.');
  if (entries.length > maxFiles) throw zipBad(`The archive has too many files (${maxFiles} maximum).`, 413);
  const seen = new Set();
  const stamp = dosStamp();
  const local = [];
  const central = [];
  let offset = 0;
  let total = 0;

  for (const entry of entries) {
    const name = safeZipPath(entry?.path);
    if (seen.has(name.toLowerCase())) throw zipBad(`Duplicate archive path: ${name}`);
    seen.add(name.toLowerCase());
    const raw = Buffer.isBuffer(entry?.data) ? entry.data : Buffer.from(String(entry?.data ?? ''), 'utf8');
    total += raw.length;
    if (total > maxBytes) throw zipBad(`The archive is too large (${Math.round(maxBytes / 1024 / 1024)} MB maximum).`, 413);
    const deflated = deflateRawSync(raw, { level: 6 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);
    const nameBytes = Buffer.from(name, 'utf8');

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(stamp.time, 10);
    header.writeUInt16LE(stamp.date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, nameBytes, body);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(method, 10);
    record.writeUInt16LE(stamp.time, 12);
    record.writeUInt16LE(stamp.date, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(raw.length, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt16LE(0, 30);
    record.writeUInt16LE(0, 32);
    record.writeUInt16LE(0, 34);
    record.writeUInt16LE(0, 36);
    record.writeUInt32LE(0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, nameBytes);
    offset += header.length + nameBytes.length + body.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...local, centralBuffer, end]);
}
