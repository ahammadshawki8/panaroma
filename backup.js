import { assetUrl, validLibrary } from './lib.js';

const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});

function safeSegment(value, fallback) {
  let name = String(value || '').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().replace(/[. ]+$/g, '').slice(0, 120);
  if (!name || name === '.' || name === '..') name = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) name = `_${name}`;
  return name;
}

function uniqueName(base, extension, used) {
  let name = `${base}${extension}`;
  for (let count = 2; used.has(name.toLowerCase()); count++) name = `${base} (${count})${extension}`;
  used.add(name.toLowerCase());
  return name;
}

export function createBackupPlan(library, root) {
  if (!validLibrary(library)) throw new Error('The library file has an unsupported format.');
  const folderNames = new Set(['unfiled']);
  const folderPaths = new Map();
  const folders = library.folders.map((folder) => {
    const backupPath = uniqueName(safeSegment(folder.name, 'Untitled folder'), '', folderNames);
    folderPaths.set(folder.id, backupPath);
    return { ...folder, backupPath };
  });
  const namesByFolder = new Map();
  const files = library.files.map((file) => {
    const folderPath = folderPaths.get(file.folderId) || 'Unfiled';
    if (!namesByFolder.has(folderPath)) namesByFolder.set(folderPath, new Set());
    const extension = String(file.path).split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    let base = safeSegment(file.name, 'Untitled image');
    if (base.toLowerCase().endsWith(`.${extension}`)) base = base.slice(0, -extension.length - 1) || 'Untitled image';
    const name = uniqueName(base, `.${extension}`, namesByFolder.get(folderPath));
    return { ...file, backupPath: `${folderPath}/${name}`, publicUrl: assetUrl(root, file) };
  });
  return {
    folders,
    files,
    manifest: { version: 1, exportedAt: new Date().toISOString(), source: new URL(root).href, folders, files }
  };
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff];
  return (value ^ 0xffffffff) >>> 0;
}

function zipTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

export async function createZip(entries) {
  if (entries.length > 65535) throw new Error('Too many items for one backup ZIP.');
  const parts = [];
  const directory = [];
  const stamp = zipTime(new Date());
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const data = entry.data instanceof Blob ? entry.data : new Blob([entry.data || '']);
    if (name.length > 65535 || data.size > 0xffffffff || offset + 30 + name.length + data.size > 0xffffffff) {
      throw new Error('This backup is too large for a standard ZIP file.');
    }
    const checksum = crc32(new Uint8Array(await data.arrayBuffer()));
    const local = new Uint8Array(30);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(10, stamp.time, true);
    localView.setUint16(12, stamp.date, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.size, true);
    localView.setUint32(22, data.size, true);
    localView.setUint16(26, name.length, true);
    parts.push(local, name, data);

    const central = new Uint8Array(46);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(12, stamp.time, true);
    centralView.setUint16(14, stamp.date, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.size, true);
    centralView.setUint32(24, data.size, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(38, entry.path.endsWith('/') ? 0x10 : 0, true);
    centralView.setUint32(42, offset, true);
    directory.push(central, name);
    offset += local.length + name.length + data.size;
  }

  const directorySize = directory.reduce((size, part) => size + part.length, 0);
  if (offset + directorySize > 0xffffffff) throw new Error('This backup is too large for a standard ZIP file.');
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}
