import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackupPlan, createZip } from './backup.js';

test('backup keeps virtual folders and gives duplicate files distinct safe paths', () => {
  const library = {
    version: 1,
    folders: [
      { id: 'one', name: 'Work/2026', createdAt: '2026-01-01' },
      { id: 'two', name: 'work_2026', createdAt: '2026-01-02' },
      { id: 'three', name: 'Empty', createdAt: '2026-01-03' }
    ],
    files: [
      { id: 'a', name: 'Poster', folderId: 'one', path: 'files/a.png', size: 3 },
      { id: 'b', name: 'poster', folderId: 'one', path: 'files/b.png', size: 3 },
      { id: 'c', name: 'CON', folderId: null, path: 'files/c.gif', size: 3 }
    ]
  };
  const plan = createBackupPlan(library, 'https://example.github.io/panaroma/');
  assert.deepEqual(plan.folders.map((folder) => folder.backupPath), ['Work_2026', 'work_2026 (2)', 'Empty']);
  assert.deepEqual(plan.files.map((file) => file.backupPath), ['Work_2026/Poster.png', 'Work_2026/poster (2).png', 'Unfiled/_CON.gif']);
  assert.equal(plan.manifest.files[0].publicUrl, 'https://example.github.io/panaroma/files/a.png');
  assert.equal(plan.manifest.folders[2].backupPath, 'Empty');
});

test('backup ZIP contains readable local entries and a central directory', async () => {
  const zip = await createZip([
    { path: 'Empty/', data: '' },
    { path: 'Images/é.png', data: new Blob([Uint8Array.from([1, 2, 3])]) },
    { path: 'manifest.json', data: '{"files":[]}' }
  ]);
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const decoder = new TextDecoder();
  let offset = 0;
  const names = [];
  for (let index = 0; index < 3; index++) {
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    names.push(name);
    if (name === 'Images/é.png') assert.deepEqual([...bytes.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size)], [1, 2, 3]);
    offset += 30 + nameLength + size;
  }
  assert.deepEqual(names, ['Empty/', 'Images/é.png', 'manifest.json']);
  assert.equal(view.getUint32(offset, true), 0x02014b50);
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(bytes.length - 12, true), 3);
});
