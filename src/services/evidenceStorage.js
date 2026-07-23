import { createId } from './utils.js';

const DB_NAME = 'globalRoadTestEvidence';
const DB_VERSION = 1;
const STORE_NAME = 'files';

export async function saveEvidenceFile(file, context = {}) {
  if (!(file instanceof Blob)) throw new Error('无效的附件文件');
  const record = {
    id: createId('evidence'),
    projectId: context.projectId || '',
    ownerType: context.ownerType || 'general',
    ownerId: context.ownerId || '',
    name: file.name || `evidence-${Date.now()}`,
    type: file.type || 'application/octet-stream',
    size: file.size || 0,
    lastModified: file.lastModified || Date.now(),
    createdAt: new Date().toISOString(),
    blob: file,
  };
  const db = await openDatabase();
  await requestPromise(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(record));
  db.close();
  return metadataOf(record);
}

export async function getEvidenceFile(id) {
  const db = await openDatabase();
  const record = await requestPromise(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id));
  db.close();
  return record || null;
}

export async function deleteEvidenceFile(id) {
  const db = await openDatabase();
  await requestPromise(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id));
  db.close();
}

export async function downloadEvidenceFile(metadata) {
  const record = await getEvidenceFile(metadata.id);
  if (!record?.blob) throw new Error('附件文件在本机存储中不存在，可能只恢复了数据索引。');
  const url = URL.createObjectURL(record.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = record.name || metadata.name || 'evidence';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function getEvidenceSummary() {
  const db = await openDatabase();
  const records = await requestPromise(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll());
  db.close();
  return { count: records.length, bytes: records.reduce((sum, record) => sum + (record.size || record.blob?.size || 0), 0), records: records.map(metadataOf) };
}

export async function verifyEvidenceMetadata(metadata = []) {
  const db = await openDatabase();
  const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
  const missing = [];
  for (const item of metadata) {
    const record = await requestPromise(store.get(item.id));
    if (!record) missing.push(item);
  }
  db.close();
  return missing;
}

export async function exportEvidenceFilesToDirectory(workspaceJson, suggestedName = 'road-test-backup') {
  if (!window.showDirectoryPicker) throw new Error('当前运行环境不支持目录导出，请单独下载附件或使用支持 File System Access API 的 Chromium/Electron 版本。');
  const root = await window.showDirectoryPicker({ mode: 'readwrite' });
  const folder = await root.getDirectoryHandle(`${suggestedName}-${new Date().toISOString().slice(0, 10)}`, { create: true });
  await writeFile(folder, 'workspace.json', new Blob([JSON.stringify(workspaceJson, null, 2)], { type: 'application/json;charset=utf-8' }));
  const evidenceFolder = await folder.getDirectoryHandle('evidence', { create: true });
  const db = await openDatabase();
  const records = await requestPromise(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll());
  db.close();
  for (const record of records) await writeFile(evidenceFolder, `${record.id}__${safeName(record.name)}`, record.blob);
  await writeFile(folder, 'evidence-manifest.json', new Blob([JSON.stringify(records.map(metadataOf), null, 2)], { type: 'application/json;charset=utf-8' }));
  return { count: records.length, bytes: records.reduce((sum, item) => sum + item.size, 0) };
}

export async function importWorkspaceFromDirectory() {
  if (!window.showDirectoryPicker) throw new Error('当前运行环境不支持目录恢复。');
  const folder = await window.showDirectoryPicker({ mode: 'read' });
  const workspace = JSON.parse(await (await folder.getFileHandle('workspace.json')).getFile().then(file => file.text()));
  const manifest = JSON.parse(await (await folder.getFileHandle('evidence-manifest.json')).getFile().then(file => file.text()));
  const evidenceFolder = await folder.getDirectoryHandle('evidence');
  const fileHandles = new Map();
  for await (const [name, handle] of evidenceFolder.entries()) if (handle.kind === 'file') fileHandles.set(name, handle);
  const db = await openDatabase();
  const missing = [];
  let restored = 0;
  for (const metadata of Array.isArray(manifest) ? manifest : []) {
    const entry = [...fileHandles.entries()].find(([name]) => name.startsWith(`${metadata.id}__`));
    if (!entry) { missing.push(metadata); continue; }
    const file = await entry[1].getFile();
    await requestPromise(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put({ ...metadata, size: file.size, type: file.type || metadata.type, blob: file }));
    restored += 1;
  }
  db.close();
  return { workspace, restored, missing };
}

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('当前环境不支持 IndexedDB，无法保存本地证据附件。'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('ownerId', 'ownerId', { unique: false });
        store.createIndex('projectId', 'projectId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开证据存储。'));
  });
}

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('证据存储操作失败。'));
  });
}

async function writeFile(folder, name, blob) {
  const handle = await folder.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function metadataOf(record) {
  const metadata = { ...record };
  delete metadata.blob;
  return metadata;
}

function safeName(value) {
  return String(value || 'evidence').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
}
