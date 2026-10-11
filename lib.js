export const OWNER = 'ahammadshawki8';
export const REPO = 'panaroma';
export const BRANCH = 'main';
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function emptyLibrary() {
  return { version: 1, folders: [], files: [] };
}

export function validLibrary(value) {
  return Boolean(value && value.version === 1 && Array.isArray(value.folders) && Array.isArray(value.files));
}

export function assetUrl(root, file) {
  return new URL(file.path, root).href;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function safeDisplayName(name) {
  return String(name || '').trim().replace(/[\r\n\t]/g, ' ').slice(0, 120);
}

export function extensionForFile(file) {
  const ext = file.name.toLowerCase().split('.').pop();
  const types = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif'
  };
  return types[ext] === file.type ? ext : null;
}

export async function validateImage(file) {
  if (!(file instanceof Blob)) return 'Choose an image file.';
  const ext = extensionForFile(file);
  if (!ext) return 'Use PNG, JPG, GIF, WebP, or AVIF images.';
  if (!file.size) return 'This file is empty.';
  if (file.size > MAX_FILE_BYTES) return 'Each image must be 20 MB or smaller.';
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  const matches = {
    png: bytes[0] === 0x89 && ascii(1, 4) === 'PNG',
    jpg: bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    jpeg: bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    gif: ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a',
    webp: ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP',
    avif: ascii(4, 12) === 'ftypavif' || ascii(4, 12) === 'ftypavis'
  };
  return matches[ext] ? null : 'The file contents do not match its image type.';
}

export function newAssetPath(id, extension) {
  return `files/${id}.${extension}`;
}
