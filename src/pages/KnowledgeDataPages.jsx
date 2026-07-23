import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { COMPLIANCE_SCENARIOS } from '../constants/compliance.js';
import { flattenRoutes } from '../services/portfolio.js';
import { exportEvidenceFilesToDirectory, getEvidenceSummary, importWorkspaceFromDirectory, verifyEvidenceMetadata } from '../services/evidenceStorage.js';
import { buildWorkspacePayload, createWorkspaceSnapshot, deleteWorkspaceSnapshot, getLocalDatabaseSummary, listWorkspaceSnapshots, resetWorkspaceData, restoreWorkspaceSnapshot, saveWorkspaceNow } from '../services/localWorkspaceDatabase.js';
import { useComplianceStore } from '../stores/useComplianceStore.js';
import { usePOIStore } from '../stores/usePOIStore.js';
import { useRoutePlannerStore } from '../stores/useRoutePlannerStore.js';
import { Button, Card, Chip, EmptyState, PageHeader, StatCard } from '../components/ui.jsx';

export function RegulationLibraryPage() {
  const profiles = useComplianceStore(state => state.profiles);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [selectedId, setSelectedId] = useState(profiles[0]?.id);
  const types = [...new Set(profiles.map(profile => profile.type))];
  const filtered = profiles.filter(profile => {
    const query = search.trim().toLowerCase();
    return (type === 'all' || profile.type === type) && (!query || [profile.name, profile.market, profile.type, profile.description].join(' ').toLowerCase().includes(query));
  });
  const selected = profiles.find(profile => profile.id === selectedId) || filtered[0];
  const categories = selected ? [...new Set(selected.scenarios.map(id => COMPLIANCE_SCENARIOS[id]?.category).filter(Boolean))] : [];

  return <div className="page-stack regulation-page">
    <PageHeader eyebrow="REGULATORY INTELLIGENCE" title="法规与市场库" description="把法规目标转译为路线需求和可执行场景；所有模板用于工程摸底，不替代正式认证判断。" actions={<Link className="button button-primary button-md" to="/projects?create=1">基于模板创建项目</Link>} />
    <section className="stats-grid compact-stats">
      <StatCard icon="RG" label="工程模板" value={profiles.length} detail="覆盖主要法规与消费者测试方向" />
      <StatCard icon="SC" label="测试场景" value={Object.keys(COMPLIANCE_SCENARIOS).length} detail="路线、限速、环境与人工验证" tone="violet" />
      <StatCard icon="MK" label="市场覆盖" value={new Set(profiles.flatMap(profile => profile.market.split(/[/、]/))).size} detail="欧洲、北美、亚洲及 UNECE" tone="green" />
      <StatCard icon="SRC" label="官方参考" value={profiles.reduce((sum, profile) => sum + profile.references.length, 0)} detail="法规原文和官方协议入口" tone="amber" />
    </section>
    <div className="regulation-layout">
      <Card className="regulation-catalog" title="模板目录" subtitle={`${filtered.length} 个匹配模板`}>
        <div className="catalog-toolbar vertical"><div className="search-input"><span>⌕</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索法规、国家或测试方向" /></div><select value={type} onChange={event => setType(event.target.value)}><option value="all">全部类型</option>{types.map(value => <option key={value}>{value}</option>)}</select></div>
        <div className="regulation-list">{filtered.map(profile => <button key={profile.id} className={selected?.id === profile.id ? 'active' : ''} onClick={() => setSelectedId(profile.id)}><span>{profile.type}</span><strong>{profile.name}</strong><small>{profile.market}</small><em>{profile.scenarios.length} 个场景 · {profile.references.length} 个来源</em></button>)}</div>
      </Card>
      {selected && <div className="regulation-detail">
        <section className="regulation-hero"><span>{selected.type}</span><h2>{selected.name}</h2><p>{selected.description}</p><div><Chip tone="blue">{selected.market}</Chip>{categories.map(category => <Chip key={category}>{category}</Chip>)}</div><Link className="button button-primary button-md" to={`/projects?create=1&profile=${selected.id}`}>用此模板创建项目</Link></section>
        <Card title="测试场景结构" subtitle="自动指标用于路线筛选，人工场景用于实际测试执行与证据记录">
          <div className="scenario-library">{categories.map(category => <section key={category}><header><strong>{category}</strong><span>{selected.scenarios.filter(id => COMPLIANCE_SCENARIOS[id]?.category === category).length} 个场景</span></header>{selected.scenarios.filter(id => COMPLIANCE_SCENARIOS[id]?.category === category).map(id => { const scenario = COMPLIANCE_SCENARIOS[id]; return <article key={id}><div><strong>{scenario.name}</strong><p>{scenario.objective}</p></div><span>{scenario.targetLabel || '人工验证'}</span><em>{scenario.manualOnly ? '人工' : '自动摸底'}</em></article>; })}</section>)}</div>
        </Card>
        <Card title="法规与协议来源" subtitle="项目立项时应冻结适用版本、实施日期和车型类别">
          {selected.references.length ? <div className="reference-list large">{selected.references.map(reference => <a key={reference.url} href={reference.url} target="_blank" rel="noreferrer"><span>{reference.label}</span><strong>打开官方来源 ↗</strong></a>)}</div> : <EmptyState title="该模板暂无固定参考链接" description="跨市场本地化项目需由法规工程师补充适用文件。" />}
          <div className="notice notice-amber">法规、NCAP 协议和道路交通规则会持续更新。平台中的模板是工程起点，不能作为法规合规或型式认证结论。</div>
        </Card>
      </div>}
    </div>
  </div>;
}

export function DataCenterPage() {
  const groups = useRoutePlannerStore(state => state.groups);
  const status = useRoutePlannerStore(state => state.status);
  const pois = usePOIStore(state => state.pois);
  const compliance = useComplianceStore();
  const routes = flattenRoutes(groups);
  const fileRef = useRef(null);
  const [storage, setStorage] = useState({ usage: 0, quota: 0, persisted: false });
  const [history, setHistory] = useState(() => loadBackupHistory());
  const [evidence, setEvidence] = useState({ count: 0, bytes: 0, records: [] });
  const [missingEvidence, setMissingEvidence] = useState([]);
  const [directoryExporting, setDirectoryExporting] = useState(false);
  const [localDb, setLocalDb] = useState({ available: true, state: 'ready', updatedAt: '', bytes: 0, snapshots: 0 });
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotLabel, setSnapshotLabel] = useState('');
  const [databaseBusy, setDatabaseBusy] = useState(false);
  const routeIds = new Set(routes.map(route => route.id));
  const orphanRouteRefs = compliance.projects.reduce((sum, project) => sum + project.routeIds.filter(id => !routeIds.has(id)).length, 0);
  const orphanIssueRefs = compliance.projects.reduce((sum, project) => sum + project.issues.filter(issue => issue.routeId && !routeIds.has(issue.routeId)).length, 0);
  const dataBytes = new Blob([JSON.stringify({ groups, pois, projects: compliance.projects })]).size;

  const evidenceMetadata = collectEvidenceMetadata(compliance.projects);
  useEffect(() => {
    updateStorage(setStorage);
    getEvidenceSummary().then(setEvidence).catch(() => {});
    verifyEvidenceMetadata(evidenceMetadata).then(setMissingEvidence).catch(() => {});
  }, [compliance.projects.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const refresh = () => Promise.all([getLocalDatabaseSummary(), listWorkspaceSnapshots()]).then(([summary, records]) => { setLocalDb(current => ({ ...current, ...summary })); setSnapshots(records); }).catch(error => setLocalDb(current => ({ ...current, available: false, state: 'error', message: error.message })));
    const onStatus = event => setLocalDb(current => ({ ...current, ...event.detail }));
    window.addEventListener('local-workspace-status', onStatus);
    refresh();
    return () => window.removeEventListener('local-workspace-status', onStatus);
  }, []);
  const refreshLocalDatabase = async () => {
    const [summary, records] = await Promise.all([getLocalDatabaseSummary(), listWorkspaceSnapshots()]);
    setLocalDb(current => ({ ...current, ...summary })); setSnapshots(records);
  };
  const workspacePayload = () => ({ ...buildWorkspacePayload(), exportedAt: new Date().toISOString() });
  const exportBackup = () => {
    useRoutePlannerStore.getState().exportData({ pois, compliance: { version: 4, activeProjectId: compliance.activeProjectId, projects: compliance.projects } });
    const entry = { id: Date.now(), createdAt: new Date().toISOString(), projects: compliance.projects.length, routes: routes.length, pois: pois.length, size: dataBytes };
    const next = [entry, ...history].slice(0, 12); setHistory(next); localStorage.setItem('roadTestStudio.backupHistory', JSON.stringify(next));
  };
  const chooseImport = () => {
    if ((routes.length || pois.length || compliance.projects.length) && !window.confirm('导入完整备份会替换当前路线、标记点和测试项目。建议先导出当前数据，是否继续？')) return;
    fileRef.current?.click();
  };
  const importBackup = event => {
    const file = event.target.files?.[0]; if (!file) return;
    useRoutePlannerStore.getState().importData(file, backup => {
      if (Array.isArray(backup.pois)) usePOIStore.getState().replacePOIs(backup.pois);
      if (backup.compliance?.projects) useComplianceStore.getState().replaceState(backup.compliance);
    });
    event.target.value = '';
  };
  const requestPersistence = async () => { if (navigator.storage?.persist) { await navigator.storage.persist(); await updateStorage(setStorage); } };
  const saveDatabase = async () => {
    setDatabaseBusy(true);
    try { await saveWorkspaceNow({ reason: '用户立即保存' }); await refreshLocalDatabase(); }
    catch (error) { alert(`保存失败：${error.message}`); }
    finally { setDatabaseBusy(false); }
  };
  const addSnapshot = async () => {
    setDatabaseBusy(true);
    try { await createWorkspaceSnapshot(snapshotLabel.trim() || `测试快照 ${new Date().toLocaleString('zh-CN')}`); setSnapshotLabel(''); await refreshLocalDatabase(); }
    catch (error) { alert(`创建快照失败：${error.message}`); }
    finally { setDatabaseBusy(false); }
  };
  const restoreSnapshot = async item => {
    if (!window.confirm(`恢复“${item.label}”会替换当前结构化数据，系统会先自动创建安全快照。是否继续？`)) return;
    setDatabaseBusy(true);
    try { await restoreWorkspaceSnapshot(item.id); await refreshLocalDatabase(); alert('快照已恢复。'); }
    catch (error) { alert(`恢复失败：${error.message}`); }
    finally { setDatabaseBusy(false); }
  };
  const removeSnapshot = async item => {
    if (!window.confirm(`删除本地快照“${item.label}”？该操作无法撤销。`)) return;
    setDatabaseBusy(true);
    try { await deleteWorkspaceSnapshot(item.id); await refreshLocalDatabase(); }
    catch (error) { alert(`删除失败：${error.message}`); }
    finally { setDatabaseBusy(false); }
  };
  const resetWorkspace = async () => {
    if (!window.confirm('重置会清空当前项目、路线和标记点。系统会先创建可恢复的安全快照，证据附件原文件不会删除。是否继续？')) return;
    setDatabaseBusy(true);
    try { await resetWorkspaceData(); await refreshLocalDatabase(); alert('测试工作区已重置，可随时从安全快照恢复。'); }
    catch (error) { alert(`重置失败：${error.message}`); }
    finally { setDatabaseBusy(false); }
  };
  const exportDirectory = async () => {
    setDirectoryExporting(true);
    try {
      const result = await exportEvidenceFilesToDirectory(workspacePayload(), 'global-road-test');
      alert(`已导出工作区和 ${result.count} 个证据附件。`);
    } catch (error) { alert(error.message); }
    finally { setDirectoryExporting(false); }
  };
  const restoreDirectory = async () => {
    if ((routes.length || pois.length || compliance.projects.length) && !window.confirm('目录恢复会替换当前工作区并覆盖同 ID 的本机证据文件。建议先导出当前数据，是否继续？')) return;
    try {
      const result = await importWorkspaceFromDirectory();
      const workspace = result.workspace;
      useRoutePlannerStore.getState().replaceGroups(workspace.groups || []);
      usePOIStore.getState().replacePOIs(workspace.pois || []);
      useComplianceStore.getState().replaceState(workspace.compliance || {});
      await saveWorkspaceNow({ reason: '从目录恢复' });
      const summary = await getEvidenceSummary(); setEvidence(summary); setMissingEvidence(result.missing);
      alert(`已恢复工作区和 ${result.restored} 个证据附件${result.missing.length ? `，${result.missing.length} 个附件缺失` : ''}。`);
    } catch (error) { alert(`目录恢复失败：${error.message}`); }
  };
  const repair = () => {
    compliance.projects.forEach(project => compliance.updateProjectById(project.id, { routeIds: project.routeIds.filter(id => routeIds.has(id)), issues: project.issues.map(issue => issue.routeId && !routeIds.has(issue.routeId) ? { ...issue, routeId: '' } : issue) }));
  };

  return <div className="page-stack data-page">
    <PageHeader eyebrow="DATA GOVERNANCE" title="数据与备份中心" description="本机 IndexedDB 自动保存全部结构化数据，无需部署服务或维护数据库；快照和目录归档负责版本回退与长期保存。" actions={<Button variant="primary" onClick={exportBackup}>导出完整备份</Button>} />
    <section className="stats-grid compact-stats">
      <StatCard icon="DB" label="结构化数据" value={formatBytes(dataBytes)} detail="项目、路线、属性和标记点" />
      <StatCard icon="RT" label="路线记录" value={routes.length} detail={`${groups.length} 个分组`} tone="violet" />
      <StatCard icon="PJ" label="项目记录" value={compliance.projects.length} detail={`${compliance.projects.reduce((sum, project) => sum + project.testRuns.length, 0)} 个测试执行`} tone="green" />
      <StatCard icon="EV" label="本机证据库" value={formatBytes(evidence.bytes)} detail={`${evidence.count} 个附件 · ${missingEvidence.length} 个缺失`} tone={missingEvidence.length ? 'amber' : 'green'} />
    </section>

    <div className="data-grid">
      <Card className="local-database-card" title="本地工作区数据库" subtitle="浏览器内置 IndexedDB · 自动保存 · 无需安装和维护">
        <div className={`local-database-status state-${localDb.state}`}><span>{localDb.state === 'saved' || localDb.state === 'ready' ? '✓' : localDb.state === 'error' ? '!' : '↻'}</span><div><strong>{localDb.available === false ? '本地数据库不可用' : localDb.state === 'saving' ? '正在保存' : localDb.state === 'pending' ? '等待自动保存' : '本地数据库运行正常'}</strong><p>{localDb.message || (localDb.updatedAt ? `最近保存：${new Date(localDb.updatedAt).toLocaleString('zh-CN')}` : '等待第一次保存')}</p></div></div>
        <div className="local-database-kpis"><span><strong>{localDb.projects ?? compliance.projects.length}</strong><small>项目</small></span><span><strong>{localDb.routes ?? routes.length}</strong><small>路线</small></span><span><strong>{localDb.pois ?? pois.length}</strong><small>标记点</small></span><span><strong>{formatBytes(localDb.bytes || dataBytes)}</strong><small>结构化数据</small></span></div>
        <div className="snapshot-composer"><input value={snapshotLabel} onChange={event => setSnapshotLabel(event.target.value)} placeholder="快照名称，例如：路线算法调整前" /><Button variant="primary" disabled={databaseBusy} onClick={addSnapshot}>创建快照</Button><Button disabled={databaseBusy} onClick={saveDatabase}>立即保存</Button><Button variant="danger" disabled={databaseBusy} onClick={resetWorkspace}>重置测试工作区</Button></div>
        <div className="notice notice-blue">应用内每次增删改都会自动保存；每天首次变更还会生成一个自动快照，最多保留 10 个。</div>
      </Card>

      <Card title="工作区备份" subtitle="JSON 适合快速迁移；目录归档可同时带走本机证据附件">
        <div className="backup-actions"><div className="backup-icon">JSON</div><div><strong>建议每次完成路线规划或道路测试后备份</strong><p>备份文件可保存到项目资料目录、另一块磁盘、移动硬盘或 NAS，并可在另一台设备完整恢复。</p></div></div>
        <div className="toolbar-row"><Button variant="primary" onClick={exportBackup}>导出 JSON</Button><Button onClick={exportDirectory} disabled={directoryExporting}>{directoryExporting ? '正在导出…' : '导出工作区 + 证据目录'}</Button><Button onClick={chooseImport}>导入 JSON</Button><Button onClick={restoreDirectory}>从证据目录完整恢复</Button><input ref={fileRef} type="file" accept=".json" hidden onChange={importBackup} /></div>
        <div className="backup-scope"><span><strong>JSON</strong>包含全部结构化数据和附件索引，不包含视频/日志文件内容</span><span><strong>目录归档</strong>包含 workspace.json、证据清单和 IndexedDB 中的附件原文件</span></div>
        <div className="notice notice-blue">当前状态：{status}</div>
      </Card>

      <Card title="浏览器存储保护" subtitle="降低浏览器自动清理本地数据的概率">
        <div className="storage-meter"><div><strong>{formatBytes(storage.usage)}</strong><span>已使用 / {formatBytes(storage.quota)}</span></div><div className="progress-track"><i className="progress-blue" style={{ width: `${storage.quota ? Math.min(100, storage.usage / storage.quota * 100) : 0}%` }} /></div></div>
        <div className={`persistence-status ${storage.persisted ? 'active' : ''}`}><span>{storage.persisted ? '✓' : '!'}</span><div><strong>{storage.persisted ? '已获得持久存储保护' : '尚未获得持久存储保护'}</strong><p>{storage.persisted ? '浏览器会尽量避免在存储压力下自动清理本应用数据。' : '这不是云备份，仍需定期导出 JSON。'}</p></div></div>
        {!storage.persisted && <Button onClick={requestPersistence}>请求持久存储权限</Button>}
      </Card>

      <Card title="数据完整性检查" subtitle="检测路线、任务和证据文件之间的失效引用">
        <div className="integrity-list"><span><i className={orphanRouteRefs ? 'warn' : 'ok'}>{orphanRouteRefs ? '!' : '✓'}</i><div><strong>项目路线引用</strong><small>{orphanRouteRefs} 个失效路线引用</small></div></span><span><i className={orphanIssueRefs ? 'warn' : 'ok'}>{orphanIssueRefs ? '!' : '✓'}</i><div><strong>问题路线引用</strong><small>{orphanIssueRefs} 个失效路线引用</small></div></span><span><i className={missingEvidence.length ? 'warn' : 'ok'}>{missingEvidence.length ? '!' : '✓'}</i><div><strong>证据附件内容</strong><small>{missingEvidence.length} 个索引找不到本机文件</small></div></span><span><i className="ok">✓</i><div><strong>数据模型版本</strong><small>v4 · IndexedDB 工作区、版本快照与证据附件</small></div></span></div>
        {!!(orphanRouteRefs + orphanIssueRefs) && <Button variant="primary" onClick={repair}>修复失效引用</Button>}
      </Card>

      <Card title="长期保存建议" subtitle="没有数据库时的可靠实践">
        <div className="retention-steps"><article><span>1</span><div><strong>IndexedDB 实时保存</strong><p>项目、路线、任务、问题、里程碑和场景结果在每次修改后自动落盘。</p></div></article><article><span>2</span><div><strong>快照用于测试回退</strong><p>修改路线算法、数据结构或批量数据前创建快照，随时恢复到之前状态。</p></div></article><article><span>3</span><div><strong>目录归档到本地磁盘</strong><p>定期导出工作区与证据目录，保存到另一个磁盘、移动硬盘或 NAS。</p></div></article><article><span>4</span><div><strong>正式多人协作后再上云</strong><p>需要权限、并发编辑和审计时再迁移后端，目前无需提前维护数据库。</p></div></article></div>
      </Card>
    </div>

    <Card title="本地版本快照" subtitle={`${snapshots.length} 个快照 · 支持创建、查看、恢复和删除`}>
      {!snapshots.length ? <EmptyState title="还没有本地快照" description="自动保存负责防丢，快照用于在测试和大改前保留可回退版本。" action={<Button variant="primary" onClick={addSnapshot}>创建第一个快照</Button>} /> : <div className="snapshot-history"><div><span>名称</span><span>类型</span><span>创建时间</span><span>规模</span><span /></div>{snapshots.map(item => <div key={item.id}><strong>{item.label}</strong><Chip tone={item.type === 'manual' ? 'blue' : item.type === 'safety' ? 'amber' : 'neutral'}>{snapshotTypeLabel(item.type)}</Chip><time>{new Date(item.createdAt).toLocaleString('zh-CN')}</time><span>{formatBytes(item.bytes)}</span><div><Button size="sm" disabled={databaseBusy} onClick={() => restoreSnapshot(item)}>恢复</Button><Button size="sm" variant="danger" disabled={databaseBusy} onClick={() => removeSnapshot(item)}>删除</Button></div></div>)}</div>}
    </Card>

    <Card title="本机备份记录" subtitle="记录从本应用触发的导出动作；文件本身位于浏览器下载目录">
      {!history.length ? <EmptyState title="尚未记录备份" description="点击“导出完整备份”后，这里会记录时间和数据规模。" /> : <div className="backup-history"><div><span>导出时间</span><span>项目</span><span>路线</span><span>标记点</span><span>文件规模</span></div>{history.map(item => <div key={item.id}><time>{new Date(item.createdAt).toLocaleString('zh-CN')}</time><span>{item.projects}</span><span>{item.routes}</span><span>{item.pois}</span><span>{formatBytes(item.size)}</span></div>)}</div>}
    </Card>
  </div>;
}

function loadBackupHistory() { try { const value = JSON.parse(localStorage.getItem('roadTestStudio.backupHistory') || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }
async function updateStorage(setStorage) { const estimate = await navigator.storage?.estimate?.() || {}; const persisted = await navigator.storage?.persisted?.() || false; setStorage({ usage: estimate.usage || 0, quota: estimate.quota || 0, persisted }); }
function formatBytes(value) { if (!value) return '0 KB'; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1024 / 1024).toFixed(1)} MB`; }
function snapshotTypeLabel(value) { return ({ manual: '手动', auto: '自动', safety: '安全', migration: '迁移' })[value] || value; }
function collectEvidenceMetadata(projects) {
  return projects.flatMap(project => [
    ...project.testRuns.flatMap(run => [...(run.attachments || []), ...Object.values(run.scenarioResults || {}).flatMap(result => result.attachments || [])]),
    ...project.issues.flatMap(issue => issue.attachments || []),
    ...Object.values(project.results || {}).flatMap(result => result.attachments || []),
  ]).filter((item, index, values) => item?.id && values.findIndex(value => value.id === item.id) === index);
}
