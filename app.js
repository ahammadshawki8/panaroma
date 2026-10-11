import { OWNER, REPO, BRANCH, assetUrl, emptyLibrary, extensionForFile, formatBytes, newAssetPath, safeDisplayName, validLibrary, validateImage } from './lib.js';

const siteRoot = new URL('./', import.meta.url);
const apiRoot = `https://api.github.com/repos/${OWNER}/${REPO}`;
const tokenKey = 'panaroma.github.token';
const state = {
  library: emptyLibrary(),
  token: localStorage.getItem(tokenKey) || '',
  view: 'all',
  folderId: null,
  query: '',
  busy: false,
  edit: null,
  movingId: null,
  sharingId: null,
  previews: new Map()
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  folderNav: $('#folder-nav'),
  folderChips: $('#folder-chips'),
  fileGrid: $('#file-grid'),
  empty: $('#empty-state'),
  drop: $('#drop-zone'),
  fileInput: $('#file-input'),
  toast: $('#toast')
};

function icon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${id}`);
  svg.append(use);
  return svg;
}

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

let toastTimer;
function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 4200);
}

function setBusy(value) {
  state.busy = value;
  document.querySelectorAll('.primary-button, .secondary-button').forEach((button) => {
    if (!button.closest('dialog')) button.disabled = value;
  });
}

function apiPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function github(path, options = {}) {
  if (!state.token) throw new Error('Connect GitHub first.');
  const response = await fetch(`${apiRoot}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${state.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    },
    cache: 'no-store'
  });
  if (!response.ok) {
    let message = `GitHub returned ${response.status}.`;
    try { message = (await response.json()).message || message; } catch { /* Keep the status message. */ }
    const permissionDenied = response.status === 403 && /resource not accessible by personal access token/i.test(message);
    if (permissionDenied) {
      message = `GitHub denied write access to ${OWNER}/${REPO}. Edit or create a fine-grained token with resource owner ${OWNER}, repository access to ${REPO}, and Repository permissions > Contents set to Read and write. Then reconnect with that token.`;
    }
    const error = new Error(message);
    error.status = response.status;
    error.permissionDenied = permissionDenied;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

async function verifyWriteAccess() {
  // The empty blob checks Contents write access without changing a branch or creating a commit.
  await github('/git/blobs', {
    method: 'POST',
    body: JSON.stringify({ content: '', encoding: 'utf-8' })
  });
}

function textToBase64(value) {
  const bytes = new TextEncoder().encode(value);
  return bytesToBase64(bytes);
}

function bytesToBase64(bytes) {
  const parts = [];
  for (let i = 0; i < bytes.length; i += 32768) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
  }
  return btoa(parts.join(''));
}

function base64ToText(value) {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function readRemoteLibrary() {
  const result = await github(`/contents/data/library.json?ref=${BRANCH}`);
  const library = JSON.parse(base64ToText(result.content));
  if (!validLibrary(library)) throw new Error('The library file has an unsupported format.');
  return { library, sha: result.sha };
}

async function loadLibrary() {
  try {
    if (state.token) {
      await verifyWriteAccess();
      state.library = (await readRemoteLibrary()).library;
    } else {
      const response = await fetch(new URL(`data/library.json?v=${Date.now()}`, siteRoot), { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load the image library.');
      const library = await response.json();
      if (!validLibrary(library)) throw new Error('The library file has an unsupported format.');
      state.library = library;
    }
    render();
  } catch (error) {
    if (state.token && (error.status === 401 || error.permissionDenied)) {
      disconnect(false);
      await loadLibrary();
      if (error.permissionDenied) {
        $('#connect-error').textContent = error.message;
        $('#connect-error').hidden = false;
        $('#connect-dialog').showModal();
      } else {
        toast('Your GitHub connection expired. Connect again to make changes.');
      }
      return;
    }
    render();
    toast(error.message);
  }
}

async function saveLibrary(message, update) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { library, sha } = await readRemoteLibrary();
    update(library);
    try {
      await github('/contents/data/library.json', {
        method: 'PUT',
        body: JSON.stringify({ message, content: textToBase64(JSON.stringify(library, null, 2) + '\n'), sha, branch: BRANCH })
      });
      state.library = library;
      render();
      return;
    } catch (error) {
      if (error.status !== 409 || attempt === 2) throw error;
    }
  }
}

function connected() {
  return Boolean(state.token);
}

function requireConnection() {
  if (connected()) return true;
  $('#connect-dialog').showModal();
  toast('Connect GitHub to make changes.');
  return false;
}

async function connect() {
  const input = $('#token-input');
  const errorBox = $('#connect-error');
  const token = input.value.trim();
  if (!token) return;
  $('#connect-submit').disabled = true;
  errorBox.hidden = true;
  const previous = state.token;
  state.token = token;
  try {
    const userResponse = await fetch('https://api.github.com/user', {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      cache: 'no-store'
    });
    if (!userResponse.ok) throw new Error('GitHub did not accept this token.');
    const user = await userResponse.json();
    if (user.login.toLowerCase() !== OWNER.toLowerCase()) throw new Error(`Use a token from the ${OWNER} account.`);
    const { library } = await readRemoteLibrary();
    await verifyWriteAccess();
    state.library = library;
    localStorage.setItem(tokenKey, token);
    input.value = '';
    $('#connect-dialog').close();
    render();
    toast('Repository connected. You can now manage your images.');
  } catch (error) {
    state.token = previous;
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    $('#connect-submit').disabled = false;
  }
}

function disconnect(announce = true) {
  state.token = '';
  localStorage.removeItem(tokenKey);
  $('#connect-dialog').close();
  render();
  if (announce) {
    loadLibrary();
    toast('GitHub disconnected from this browser.');
  }
}

function viewName() {
  if (state.view === 'recent') return 'Recent';
  if (state.view === 'folder') return state.library.folders.find((folder) => folder.id === state.folderId)?.name || 'Folder';
  return 'All images';
}

function visibleFiles() {
  let files = [...state.library.files];
  if (state.view === 'folder') files = files.filter((file) => file.folderId === state.folderId);
  if (state.query) files = files.filter((file) => file.name.toLowerCase().includes(state.query));
  files.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (state.view === 'recent') files = files.slice(0, 12);
  return files;
}

function switchView(view, folderId = null) {
  state.view = view;
  state.folderId = folderId;
  render();
}

function render() {
  const files = visibleFiles();
  $('#all-count').textContent = String(state.library.files.length);
  $('#stat-images').textContent = String(state.library.files.length);
  $('#stat-folders').textContent = String(state.library.folders.length);
  $('#breadcrumb-name').textContent = viewName();
  $('#section-title').firstChild.textContent = `${viewName()} `;
  $('#section-count').textContent = String(files.length);
  $('#connect-label').textContent = connected() ? 'Connected' : 'Connect GitHub';
  $('#connect-button').classList.toggle('connected', connected());
  $('#status-light').classList.toggle('connected', connected());
  $('#sidebar-status').textContent = connected() ? 'GitHub connected' : 'View only';
  $('#disconnect-button').hidden = !connected();
  document.querySelectorAll('[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === state.view));
  renderFolders();
  renderFiles(files);
}

function renderFolders() {
  elements.folderNav.replaceChildren();
  elements.folderChips.replaceChildren();
  for (const folder of state.library.folders) {
    const count = state.library.files.filter((file) => file.folderId === folder.id).length;
    const sidebarButton = node('button', `folder-item${state.view === 'folder' && state.folderId === folder.id ? ' active' : ''}`);
    sidebarButton.type = 'button';
    sidebarButton.append(icon('folder'), node('span', '', folder.name), node('span', 'folder-count', String(count)));
    sidebarButton.addEventListener('click', () => switchView('folder', folder.id));
    elements.folderNav.append(sidebarButton);
    if (state.view === 'all') {
      const chip = node('button', 'folder-chip');
      chip.type = 'button';
      chip.append(icon('folder'), node('span', '', folder.name), node('span', '', String(count)));
      chip.addEventListener('click', () => switchView('folder', folder.id));
      elements.folderChips.append(chip);
    }
  }
  if (state.view === 'folder') {
    const back = node('button', 'folder-chip', 'All images');
    back.type = 'button';
    back.addEventListener('click', () => switchView('all'));
    const rename = node('button', 'folder-chip', 'Rename folder');
    rename.type = 'button';
    rename.addEventListener('click', renameFolder);
    const remove = node('button', 'folder-chip', 'Remove folder');
    remove.type = 'button';
    remove.addEventListener('click', deleteFolder);
    elements.folderChips.append(back, rename, remove);
  }
}

function renderFiles(files) {
  elements.fileGrid.replaceChildren();
  for (const file of files) elements.fileGrid.append(fileCard(file));
  elements.empty.hidden = files.length > 0;
  if (!files.length) {
    const searching = Boolean(state.query);
    $('#empty-title').textContent = searching ? 'No matching images' : state.view === 'folder' ? 'This folder is empty' : 'A fresh start';
    $('#empty-copy').textContent = searching ? 'Try another search.' : state.view === 'folder' ? 'Upload an image here or move one from another folder.' : 'Upload your first image and it will appear right here.';
  }
}

function fileCard(file) {
  const card = node('article', 'file-card');
  const thumb = node('div', 'file-thumb');
  const placeholder = node('span', 'thumb-placeholder');
  placeholder.append(icon('image'));
  const image = node('img');
  image.alt = '';
  image.loading = 'lazy';
  image.src = state.previews.get(file.id) || assetUrl(siteRoot, file);
  image.addEventListener('load', () => { placeholder.hidden = true; });
  image.addEventListener('error', () => { image.hidden = true; });
  const type = node('span', 'file-type', file.path.split('.').pop().toUpperCase());
  thumb.append(placeholder, image, type);
  if (state.previews.has(file.id)) thumb.append(node('span', 'pending-badge', 'Publishing'));
  const body = node('div', 'file-card-body');
  const title = node('h3', 'file-card-title', file.name);
  title.title = file.name;
  const folder = state.library.folders.find((item) => item.id === file.folderId);
  const meta = node('div', 'file-meta');
  meta.append(node('span', '', folder?.name || 'All images'), node('i'), node('span', '', formatBytes(file.size)));
  const actions = node('div', 'file-card-actions');
  const copy = node('button', 'card-action copy');
  copy.type = 'button';
  copy.append(icon('link'), node('span', '', 'Share link'));
  copy.addEventListener('click', () => openShare(file.id));
  const more = node('button', 'card-action more');
  more.type = 'button';
  more.title = 'More actions';
  more.setAttribute('aria-label', `More actions for ${file.name}`);
  more.append(icon('dots'));
  const menu = node('div', 'file-menu');
  menu.hidden = true;
  for (const [label, action, danger] of [
    ['Rename', () => renameFile(file.id), false],
    ['Move to folder', () => openMove(file.id), false],
    ['Delete image', () => deleteFile(file.id), true]
  ]) {
    const button = node('button', danger ? 'danger' : '', label);
    button.type = 'button';
    button.addEventListener('click', () => { menu.hidden = true; action(); });
    menu.append(button);
  }
  more.addEventListener('click', () => { menu.hidden = !menu.hidden; });
  actions.append(copy, more);
  body.append(title, meta, actions, menu);
  card.append(thumb, body);
  return card;
}

function openEdit(kind, id = null) {
  if (!requireConnection()) return;
  state.edit = { kind, id };
  const target = kind === 'folder' ? state.library.folders.find((item) => item.id === id) : state.library.files.find((item) => item.id === id);
  $('#edit-title').textContent = id ? `Rename ${kind}` : 'New folder';
  $('#edit-description').textContent = id ? 'The public image link will not change.' : 'Create a space for related images.';
  $('#edit-label').textContent = kind === 'folder' ? 'Folder name' : 'Image name';
  $('#edit-submit').textContent = id ? 'Save name' : 'Create folder';
  $('#edit-input').value = target?.name || '';
  $('#edit-error').hidden = true;
  $('#edit-dialog').showModal();
  $('#edit-input').focus();
}

function renameFile(id) { openEdit('file', id); }
function renameFolder() { openEdit('folder', state.folderId); }

async function saveEdit() {
  const name = safeDisplayName($('#edit-input').value);
  const error = $('#edit-error');
  if (!name) { error.textContent = 'Enter a name.'; error.hidden = false; return; }
  const { kind, id } = state.edit;
  $('#edit-submit').disabled = true;
  error.hidden = true;
  try {
    await saveLibrary(id ? `Rename ${kind}` : 'Create folder', (library) => {
      if (kind === 'folder' && !id) {
        if (library.folders.some((folder) => folder.name.toLowerCase() === name.toLowerCase())) throw new Error('A folder with that name already exists.');
        library.folders.push({ id: crypto.randomUUID(), name, createdAt: new Date().toISOString() });
      } else {
        const item = (kind === 'folder' ? library.folders : library.files).find((entry) => entry.id === id);
        if (!item) throw new Error('This item no longer exists. Refresh the page.');
        item.name = name;
      }
    });
    $('#edit-dialog').close();
    toast(id ? 'Name updated. Embed links are unchanged.' : 'Folder created.');
  } catch (caught) {
    error.textContent = caught.message;
    error.hidden = false;
  } finally { $('#edit-submit').disabled = false; }
}

function openMove(id) {
  if (!requireConnection()) return;
  state.movingId = id;
  const select = $('#move-select');
  select.replaceChildren();
  select.append(new Option('All images', ''));
  for (const folder of state.library.folders) select.append(new Option(folder.name, folder.id));
  select.value = state.library.files.find((file) => file.id === id)?.folderId || '';
  $('#move-error').hidden = true;
  $('#move-dialog').showModal();
}

async function saveMove() {
  const folderId = $('#move-select').value || null;
  $('#move-submit').disabled = true;
  $('#move-error').hidden = true;
  try {
    await saveLibrary('Move image', (library) => {
      const file = library.files.find((entry) => entry.id === state.movingId);
      if (!file) throw new Error('This image no longer exists. Refresh the page.');
      file.folderId = folderId;
    });
    $('#move-dialog').close();
    toast('Image moved. Its embed link is unchanged.');
  } catch (error) {
    $('#move-error').textContent = error.message;
    $('#move-error').hidden = false;
  } finally { $('#move-submit').disabled = false; }
}

async function deleteFolder() {
  if (!requireConnection()) return;
  const folder = state.library.folders.find((entry) => entry.id === state.folderId);
  if (!folder || !confirm(`Remove "${folder.name}"? Images inside will move to All images. Their embed links will keep working.`)) return;
  try {
    await saveLibrary('Remove folder', (library) => {
      library.folders = library.folders.filter((entry) => entry.id !== folder.id);
      for (const file of library.files) if (file.folderId === folder.id) file.folderId = null;
    });
    switchView('all');
    toast('Folder removed. Images and links are unchanged.');
  } catch (error) { toast(error.message); }
}

async function deleteFile(id) {
  if (!requireConnection()) return;
  const file = state.library.files.find((entry) => entry.id === id);
  if (!file || !confirm(`Permanently delete "${file.name}"? Its embed link will stop working.`)) return;
  setBusy(true);
  try {
    await saveLibrary('Remove image from library', (library) => {
      library.files = library.files.filter((entry) => entry.id !== id);
    });
    const content = await github(`/contents/${apiPath(file.path)}?ref=${BRANCH}`);
    await github(`/contents/${apiPath(file.path)}`, {
      method: 'DELETE',
      body: JSON.stringify({ message: `Delete image ${id}`, sha: content.sha, branch: BRANCH })
    });
    toast('Image deleted. Its embed link will stop working after publishing.');
  } catch (error) { toast(`Could not fully delete the image: ${error.message}`); }
  finally { setBusy(false); }
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function openShare(id) {
  const file = state.library.files.find((entry) => entry.id === id);
  if (!file) return;
  state.sharingId = id;
  const url = assetUrl(siteRoot, file);
  $('#share-url').value = url;
  $('#share-markdown').value = `![${file.name.replaceAll(']', '\\]')}](${url})`;
  $('#share-html').value = `<img src="${escapeHtml(url)}" alt="${escapeHtml(file.name)}">`;
  const preview = $('#share-preview');
  preview.replaceChildren();
  const image = node('img');
  image.alt = file.name;
  image.src = state.previews.get(id) || url;
  preview.append(image);
  $('#share-dialog').showModal();
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const field = node('textarea');
    field.value = value;
    document.body.append(field);
    field.select();
    document.execCommand('copy');
    field.remove();
  }
  toast('Copied to clipboard.');
}

async function uploadFiles(fileList) {
  if (!requireConnection() || state.busy) return;
  const files = Array.from(fileList);
  if (!files.length) return;
  setBusy(true);
  let uploaded = 0;
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const issue = await validateImage(file);
      if (issue) { toast(`${file.name}: ${issue}`); continue; }
      toast(`Uploading ${index + 1} of ${files.length}: ${file.name}`);
      const id = crypto.randomUUID();
      const path = newAssetPath(id, extensionForFile(file));
      const bytes = new Uint8Array(await file.arrayBuffer());
      await github(`/contents/${apiPath(path)}`, {
        method: 'PUT',
        body: JSON.stringify({ message: `Add image ${id}`, content: bytesToBase64(bytes), branch: BRANCH })
      });
      const entry = {
        id, path, name: safeDisplayName(file.name.replace(/\.[^.]+$/, '')) || 'Untitled image',
        folderId: state.view === 'folder' ? state.folderId : null,
        mime: file.type, size: file.size, createdAt: new Date().toISOString()
      };
      await saveLibrary('Add image to library', (library) => {
        if (!library.files.some((item) => item.id === id)) library.files.push(entry);
      });
      state.previews.set(id, URL.createObjectURL(file));
      uploaded++;
      render();
      setTimeout(() => {
        const preview = state.previews.get(id);
        if (preview) URL.revokeObjectURL(preview);
        state.previews.delete(id);
        render();
      }, 90000);
    }
    if (uploaded) toast(`${uploaded} image${uploaded === 1 ? '' : 's'} uploaded. Public links may take a minute to publish.`);
  } catch (error) {
    toast(`Upload stopped: ${error.message}`);
  } finally {
    elements.fileInput.value = '';
    setBusy(false);
  }
}

function chooseFiles() {
  if (requireConnection()) elements.fileInput.click();
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
$('#search-input').addEventListener('input', (event) => { state.query = event.target.value.trim().toLowerCase(); render(); });
for (const selector of ['#hero-upload', '#toolbar-upload', '#browse-button']) $(selector).addEventListener('click', (event) => { event.stopPropagation(); chooseFiles(); });
for (const selector of ['#new-folder-button', '#sidebar-new-folder']) $(selector).addEventListener('click', () => openEdit('folder'));
elements.fileInput.addEventListener('change', (event) => uploadFiles(event.target.files));
elements.drop.addEventListener('click', chooseFiles);
elements.drop.addEventListener('dragover', (event) => { event.preventDefault(); elements.drop.classList.add('dragging'); });
elements.drop.addEventListener('dragleave', () => elements.drop.classList.remove('dragging'));
elements.drop.addEventListener('drop', (event) => { event.preventDefault(); elements.drop.classList.remove('dragging'); uploadFiles(event.dataTransfer.files); });
$('#connect-button').addEventListener('click', () => $('#connect-dialog').showModal());
$('#connect-submit').addEventListener('click', connect);
$('#disconnect-button').addEventListener('click', () => disconnect());
$('#edit-submit').addEventListener('click', saveEdit);
$('#move-submit').addEventListener('click', saveMove);
$('#share-close').addEventListener('click', () => $('#share-dialog').close());
document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', () => copyText($(`#share-${button.dataset.copy}`).value)));
for (const [form, action] of [['#connect-form', connect], ['#edit-form', saveEdit]]) {
  $(form).addEventListener('submit', (event) => {
    event.preventDefault();
    if (event.submitter?.classList.contains('close-button')) $(form).closest('dialog').close();
    else action();
  });
}
$('#move-dialog form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.submitter?.classList.contains('close-button')) $('#move-dialog').close();
  else saveMove();
});

render();
loadLibrary();
