import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { COMPLIANCE_SCENARIOS } from '../constants/compliance.js';
import { flattenRoutes } from '../services/portfolio.js';
import { exportEvidenceFilesToDirectory, getEvidenceSummary, importWorkspaceFromDirectory, verifyEvidenceMetadata } from '../services/evidenceStorage.js';
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
  const workspacePayload = () => ({ version: 3, exportedAt: new Date().toISOString(), groups, pois, compliance: { version: 3, activeProjectId: compliance.activeProjectId, projects: compliance.projects } });
  const exportBackup = () => {
    useRoutePlannerStore.getState().exportData({ pois, compliance: { version: 2, activeProjectId: compliance.activeProjectId, projects: compliance.projects } });
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
      const summary = await getEvidenceSummary(); setEvidence(summary); setMissingEvidence(result.missing);
      alert(`已恢复工作区和 ${result.restored} 个证据附件${result.missing.length ? `，${result.missing.length} 个附件缺失` : ''}。`);
    } catch (error) { alert(`目录恢复失败：${error.message}`); }
  };
  const repair = () => {
    compliance.projects.forEach(project => compliance.updateProjectById(project.id, { routeIds: project.routeIds.filter(id => routeIds.has(id)), issues: project.issues.map(issue => issue.routeId && !routeIds.has(issue.routeId) ? { ...issue, routeId: '' } : issue) }));
  };

  return <div className="page-stack data-page">
    <PageHeader eyebrow="DATA GOVERNANCE" title="数据与备份中心" description="当前版本无需数据库即可运行；这里负责完整备份、迁移、完整性检查和长期保存策略。" actions={<Button variant="primary" onClick={exportBackup}>导出完整备份</Button>} />
    <section className="stats-grid compact-stats">
      <StatCard icon="DB" label="结构化数据" value={formatBytes(dataBytes)} detail="项目、路线、属性和标记点" />
      <StatCard icon="RT" label="路线记录" value={routes.length} detail={`${groups.length} 个分组`} tone="violet" />
      <StatCard icon="PJ" label="项目记录" value={compliance.projects.length} detail={`${compliance.projects.reduce((sum, project) => sum + project.testRuns.length, 0)} 个测试执行`} tone="green" />
      <StatCard icon="EV" label="本机证据库" value={formatBytes(evidence.bytes)} detail={`${evidence.count} 个附件 · ${missingEvidence.length} 个缺失`} tone={missingEvidence.length ? 'amber' : 'green'} />
    </section>

    <div className="data-grid">
      <Card title="工作区备份" subtitle="JSON 适合快速迁移；目录归档可同时带走本机证据附件">
        <div className="backup-actions"><div className="backup-icon">JSON</div><div><strong>建议每次完成路线规划或道路测试后备份</strong><p>备份文件可保存到 OneDrive、企业网盘、Git LFS 或受控文档系统，并可在另一台设备完整恢复。</p></div></div>
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
        <div className="integrity-list"><span><i className={orphanRouteRefs ? 'warn' : 'ok'}>{orphanRouteRefs ? '!' : '✓'}</i><div><strong>项目路线引用</strong><small>{orphanRouteRefs} 个失效路线引用</small></div></span><span><i className={orphanIssueRefs ? 'warn' : 'ok'}>{orphanIssueRefs ? '!' : '✓'}</i><div><strong>问题路线引用</strong><small>{orphanIssueRefs} 个失效路线引用</small></div></span><span><i className={missingEvidence.length ? 'warn' : 'ok'}>{missingEvidence.length ? '!' : '✓'}</i><div><strong>证据附件内容</strong><small>{missingEvidence.length} 个索引找不到本机文件</small></div></span><span><i className="ok">✓</i><div><strong>数据模型版本</strong><small>v3 · 支持现场会话与证据附件</small></div></span></div>
        {!!(orphanRouteRefs + orphanIssueRefs) && <Button variant="primary" onClick={repair}>修复失效引用</Button>}
      </Card>

      <Card title="长期保存建议" subtitle="没有数据库时的可靠实践">
        <div className="retention-steps"><article><span>1</span><div><strong>本地实时保存</strong><p>所有编辑自动写入浏览器 localStorage，适合单机快速工作。</p></div></article><article><span>2</span><div><strong>JSON 作为可迁移主备份</strong><p>定期导出并用日期命名，保留每日或每周版本。</p></div></article><article><span>3</span><div><strong>同步到受控云盘</strong><p>将备份放入 OneDrive、SharePoint、企业网盘或 Git LFS，实现跨设备和版本留存。</p></div></article><article><span>4</span><div><strong>团队化后升级后端</strong><p>多人协作、权限、审计和大附件场景建议接入 Supabase/PostgreSQL 与对象存储。</p></div></article></div>
      </Card>
    </div>

    <Card title="本机备份记录" subtitle="记录从本应用触发的导出动作；文件本身位于浏览器下载目录">
      {!history.length ? <EmptyState title="尚未记录备份" description="点击“导出完整备份”后，这里会记录时间和数据规模。" /> : <div className="backup-history"><div><span>导出时间</span><span>项目</span><span>路线</span><span>标记点</span><span>文件规模</span></div>{history.map(item => <div key={item.id}><time>{new Date(item.createdAt).toLocaleString('zh-CN')}</time><span>{item.projects}</span><span>{item.routes}</span><span>{item.pois}</span><span>{formatBytes(item.size)}</span></div>)}</div>}
    </Card>
  </div>;
}

function loadBackupHistory() { try { const value = JSON.parse(localStorage.getItem('roadTestStudio.backupHistory') || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }
async function updateStorage(setStorage) { const estimate = await navigator.storage?.estimate?.() || {}; const persisted = await navigator.storage?.persisted?.() || false; setStorage({ usage: estimate.usage || 0, quota: estimate.quota || 0, persisted }); }
function formatBytes(value) { if (!value) return '0 KB'; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1024 / 1024).toFixed(1)} MB`; }
function collectEvidenceMetadata(projects) {
  return projects.flatMap(project => [
    ...project.testRuns.flatMap(run => [...(run.attachments || []), ...Object.values(run.scenarioResults || {}).flatMap(result => result.attachments || [])]),
    ...project.issues.flatMap(issue => issue.attachments || []),
    ...Object.values(project.results || {}).flatMap(result => result.attachments || []),
  ]).filter((item, index, values) => item?.id && values.findIndex(value => value.id === item.id) === index);
}
