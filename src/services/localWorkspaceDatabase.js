import { useComplianceStore } from '../stores/useComplianceStore.js';
import { usePOIStore } from '../stores/usePOIStore.js';
import { useRoutePlannerStore } from '../stores/useRoutePlannerStore.js';
import { createId } from './utils.js';

const DB_NAME = 'globalRoadTestWorkspace';
const DB_VERSION = 1;
const WORKSPACE_STORE = 'workspace';
const SNAPSHOT_STORE = 'snapshots';
const CURRENT_ID = 'current';
const AUTO_SAVE_DELAY = 450;
const AUTO_SNAPSHOT_INTERVAL = 24 * 60 * 60 * 1000;
let saveTimer = null;
let saveQueue = Promise.resolve();
let stopSubscriptions = [];

export async function initializeLocalWorkspace() {
  if (!globalThis.indexedDB) return publishStatus({ available: false, state: 'fallback', message: 'IndexedDB 不可用，正在使用兼容缓存。' });
  try {
    const db = await openDatabase();
    const current = await requestPromise(db.transaction(WORKSPACE_STORE, 'readonly').objectStore(WORKSPACE_STORE).get(CURRENT_ID));
    db.close();
    if (current?.payload) {
      applyWorkspace(current.payload);
      return publishStatus({ available: true, state: 'ready', updatedAt: current.updatedAt, message: '已从本地工作区数据库恢复。' });
    }
    await saveWorkspaceNow({ reason: '首次迁移', createSnapshot: true, snapshotType: 'migration' });
    return publishStatus({ available: true, state: 'ready', message: '现有数据已迁移到本地工作区数据库。' });
  } catch (error) {
    return publishStatus({ available: false, state: 'error', message: `本地数据库初始化失败：${error.message}` });
  }
}

export function startLocalWorkspacePersistence() {
  if (stopSubscriptions.length) return () => stopLocalWorkspacePersistence();
  const watch = selector => (state, previous) => { if (selector(state) !== selector(previous)) queueWorkspaceSave(); };
  stopSubscriptions = [
    useRoutePlannerStore.subscribe(watch(state => state.groups)),
    usePOIStore.subscribe(watch(state => state.pois)),
    useComplianceStore.subscribe(watch(state => state.projects)),
    useComplianceStore.subscribe(watch(state => state.activeProjectId)),
  ];
  const flush = () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; saveWorkspaceNow({ reason: '页面关闭前保存' }).catch(() => {}); } };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  return () => stopLocalWorkspacePersistence();
}

export function queueWorkspaceSave() {
  publishStatus({ available: true, state: 'pending', message: '有更改待保存…' });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveWorkspaceNow({ reason: '自动保存', allowAutoSnapshot: true }).catch(error => publishStatus({ available: false, state: 'error', message: `自动保存失败：${error.message}` }));
  }, AUTO_SAVE_DELAY);
}

export function saveWorkspaceNow(options = {}) {
  const task = saveQueue.catch(() => {}).then(() => performWorkspaceSave(options));
  saveQueue = task;
  return task;
}

async function performWorkspaceSave({ reason = '立即保存', createSnapshot = false, snapshotType = 'manual', snapshotLabel = '', allowAutoSnapshot = false } = {}) {
  if (!globalThis.indexedDB) throw new Error('当前环境不支持 IndexedDB');
  publishStatus({ available: true, state: 'saving', message: '正在写入本地数据库…' });
  const payload = buildWorkspacePayload();
  const updatedAt = new Date().toISOString();
  const db = await openDatabase();
  try {
    const transaction = db.transaction([WORKSPACE_STORE, SNAPSHOT_STORE], 'readwrite');
    transaction.objectStore(WORKSPACE_STORE).put({ id: CURRENT_ID, version: 1, updatedAt, reason, payload });
    if (createSnapshot) transaction.objectStore(SNAPSHOT_STORE).put(snapshotRecord(payload, snapshotType, snapshotLabel || reason, updatedAt));
    await transactionPromise(transaction);
  } finally { db.close(); }
  if (allowAutoSnapshot) await createAutoSnapshotIfDue(payload, updatedAt);
  const detail = { available: true, state: 'saved', updatedAt, message: '所有更改已保存到本机。', bytes: byteSize(payload) };
  publishStatus(detail);
  return detail;
}

export async function createWorkspaceSnapshot(label = '') {
  return saveWorkspaceNow({ reason: label || '手动快照', createSnapshot: true, snapshotType: 'manual', snapshotLabel: label || '手动快照' });
}

export async function listWorkspaceSnapshots() {
  const db = await openDatabase();
  const records = await requestPromise(db.transaction(SNAPSHOT_STORE, 'readonly').objectStore(SNAPSHOT_STORE).getAll());
  db.close();
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(snapshotMetadata);
}

export async function restoreWorkspaceSnapshot(id) {
  const db = await openDatabase();
  const record = await requestPromise(db.transaction(SNAPSHOT_STORE, 'readonly').objectStore(SNAPSHOT_STORE).get(id));
  db.close();
  if (!record?.payload) throw new Error('快照不存在或内容损坏');
  await saveWorkspaceNow({ reason: '恢复前安全快照', createSnapshot: true, snapshotType: 'safety', snapshotLabel: '恢复前安全快照' });
  applyWorkspace(record.payload);
  await saveWorkspaceNow({ reason: `恢复快照：${record.label || record.createdAt}` });
  return snapshotMetadata(record);
}

export async function deleteWorkspaceSnapshot(id) {
  const db = await openDatabase();
  await requestPromise(db.transaction(SNAPSHOT_STORE, 'readwrite').objectStore(SNAPSHOT_STORE).delete(id));
  db.close();
}

export async function resetWorkspaceData() {
  await saveWorkspaceNow({ reason: '重置前安全快照', createSnapshot: true, snapshotType: 'safety', snapshotLabel: '重置工作区前' });
  useRoutePlannerStore.getState().replaceGroups([]);
  usePOIStore.getState().replacePOIs([]);
  useComplianceStore.getState().replaceState({ projects: [], activeProjectId: null });
  return saveWorkspaceNow({ reason: '重置测试工作区' });
}

export async function getLocalDatabaseSummary() {
  if (!globalThis.indexedDB) return { available: false, snapshots: 0, bytes: 0, updatedAt: '', state: 'fallback' };
  const db = await openDatabase();
  const transaction = db.transaction([WORKSPACE_STORE, SNAPSHOT_STORE], 'readonly');
  const currentRequest = transaction.objectStore(WORKSPACE_STORE).get(CURRENT_ID);
  const snapshotsRequest = transaction.objectStore(SNAPSHOT_STORE).getAll();
  const [current, snapshots] = await Promise.all([requestPromise(currentRequest), requestPromise(snapshotsRequest)]);
  db.close();
  return {
    available: true,
    state: 'ready',
    updatedAt: current?.updatedAt || '',
    bytes: current?.payload ? byteSize(current.payload) : 0,
    snapshots: snapshots.length,
    projects: current?.payload?.compliance?.projects?.length || 0,
    routes: (current?.payload?.groups || []).reduce((sum, group) => sum + (group.routes?.length || 0), 0),
    pois: current?.payload?.pois?.length || 0,
  };
}

export function buildWorkspacePayload() {
  const routeState = useRoutePlannerStore.getState();
  const poiState = usePOIStore.getState();
  const complianceState = useComplianceStore.getState();
  return {
    version: 4,
    savedAt: new Date().toISOString(),
    groups: structuredCopy(routeState.groups),
    pois: structuredCopy(poiState.pois),
    compliance: { version: 4, activeProjectId: complianceState.activeProjectId, projects: structuredCopy(complianceState.projects) },
  };
}

function applyWorkspace(payload) {
  useRoutePlannerStore.getState().replaceGroups(payload.groups || []);
  usePOIStore.getState().replacePOIs(payload.pois || []);
  useComplianceStore.getState().replaceState(payload.compliance || {});
}

async function createAutoSnapshotIfDue(payload, createdAt) {
  const db = await openDatabase();
  const records = await requestPromise(db.transaction(SNAPSHOT_STORE, 'readonly').objectStore(SNAPSHOT_STORE).getAll());
  const latestAuto = records.filter(item => item.type === 'auto').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!latestAuto || new Date(createdAt).getTime() - new Date(latestAuto.createdAt).getTime() >= AUTO_SNAPSHOT_INTERVAL) {
    await requestPromise(db.transaction(SNAPSHOT_STORE, 'readwrite').objectStore(SNAPSHOT_STORE).put(snapshotRecord(payload, 'auto', '每日自动快照', createdAt)));
  }
  db.close();
  await pruneSnapshots();
}

async function pruneSnapshots() {
  const db = await openDatabase();
  const records = await requestPromise(db.transaction(SNAPSHOT_STORE, 'readonly').objectStore(SNAPSHOT_STORE).getAll());
  const removable = records.filter(item => item.type === 'auto').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(10);
  if (removable.length) {
    const transaction = db.transaction(SNAPSHOT_STORE, 'readwrite');
    removable.forEach(item => transaction.objectStore(SNAPSHOT_STORE).delete(item.id));
    await transactionPromise(transaction);
  }
  db.close();
}

function snapshotRecord(payload, type, label, createdAt) {
  return { id: createId('workspace-snapshot'), type, label, createdAt, bytes: byteSize(payload), payload };
}

function snapshotMetadata(record) {
  const metadata = { ...record };
  delete metadata.payload;
  return metadata;
}

function publishStatus(detail) {
  globalThis.window?.dispatchEvent?.(new CustomEvent('local-workspace-status', { detail }));
  return detail;
}

function stopLocalWorkspacePersistence() {
  stopSubscriptions.forEach(unsubscribe => unsubscribe());
  stopSubscriptions = [];
  clearTimeout(saveTimer);
  saveTimer = null;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WORKSPACE_STORE)) db.createObjectStore(WORKSPACE_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        const store = db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('type', 'type', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开本地工作区数据库'));
  });
}

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('本地数据库操作失败'));
  });
}

function transactionPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('本地数据库事务失败'));
    transaction.onabort = () => reject(transaction.error || new Error('本地数据库事务已中止'));
  });
}

function byteSize(value) {
  return new Blob([JSON.stringify(value)]).size;
}

function structuredCopy(value) {
  return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
