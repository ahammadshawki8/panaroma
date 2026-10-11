import test from 'node:test';
import assert from 'node:assert/strict';
import { assetUrl, newAssetPath, safeDisplayName, validateImage } from './lib.js';

test('virtual folder and name changes keep the embed URL stable', () => {
  const file = { path: newAssetPath('fixed-id', 'png'), name: 'First name', folderId: null };
  const before = assetUrl('https://example.github.io/panaroma/', file);
  file.name = 'New name';
  file.folderId = 'folder-2';
  assert.equal(assetUrl('https://example.github.io/panaroma/', file), before);
  assert.equal(before, 'https://example.github.io/panaroma/files/fixed-id.png');
});

test('rejects a disguised HTML file', async () => {
  const file = new File(['<script>alert(1)</script>'], 'poster.png', { type: 'image/png' });
  assert.match(await validateImage(file), /contents do not match/);
});

test('accepts a real PNG signature and trims display names', async () => {
  const file = new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])], 'poster.png', { type: 'image/png' });
  assert.equal(await validateImage(file), null);
  assert.equal(safeDisplayName('  Poster\nOne  '), 'Poster One');
});
