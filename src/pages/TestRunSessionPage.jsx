import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import EvidenceManager from '../components/EvidenceManager.jsx';
import MapCanvas from '../components/MapCanvas.jsx';
import { Button, Card, EmptyState, ProgressBar, StatusBadge } from '../components/ui.jsx';
import { COMPLIANCE_SCENARIOS, TEST_STATUSES, getComplianceProfile } from '../constants/compliance.js';
import { flattenRoutes } from '../services/portfolio.js';
import { RUN_STATUSES, getRunReadiness, getRunResourceConflicts, useComplianceStore } from '../stores/useComplianceStore.js';
import { useRoutePlannerStore } from '../stores/useRoutePlannerStore.js';

const RUN_LABELS = Object.fromEntries(RUN_STATUSES.map(item => [item.value, item.label]));

export default function TestRunSessionPage() {
  const { projectId, runId } = useParams();
  const navigate = useNavigate();
  const store = useComplianceStore();
  const groups = useRoutePlannerStore(state => state.groups);
  const routes = flattenRoutes(groups);
  const project = store.projects.find(item => item.id === projectId);
  const run = project?.testRuns.find(item => item.id === runId);
  const route = routes.find(item => item.id === run?.routeId);
  const routeId = route?.id;
  const [clock, setClock] = useState(() => Date.now());
  const [checkpointNote, setCheckpointNote] = useState('');
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const [startAttempted, setStartAttempted] = useState(false);

  useEffect(() => {
    if (routeId) useRoutePlannerStore.getState().locateRoute(routeId);
  }, [routeId]);
  useEffect(() => {
    if (run?.status !== 'running') return undefined;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run?.status]);

  if (!project || !run) return <div className="page-stack"><EmptyState title="测试任务不存在" description="任务可能已经被删除或不在当前备份中。" action={<Link className="button button-primary button-md" to="/execution">返回执行中心</Link>} /></div>;
  const profile = getComplianceProfile(project.profileId);
  const completedScenarios = run.scenarioIds.filter(id => ['passed', 'failed', 'blocked', 'not_applicable'].includes(run.scenarioResults?.[id]?.status)).length;
  const checklistDone = run.checklist.filter(item => item.checked).length;
  const elapsed = run.startedAt ? Math.max(0, (run.endedAt ? new Date(run.endedAt).getTime() : clock) - new Date(run.startedAt).getTime()) : 0;
  const readiness = getRunReadiness(run, routes);
  const resourceConflicts = getRunResourceConflicts({ ...run, projectId: project.id }, store.projects);
  const startBlockers = [...readiness.missing.map(item => item.label), ...resourceConflicts];
  const canStart = readiness.ready && !resourceConflicts.length;
  const recordLocked = ['review', 'completed', 'cancelled'].includes(run.status);
  const fieldWorkEditable = ['running', 'paused'].includes(run.status);
  const configurationLocked = ['running', 'review', 'completed', 'cancelled'].includes(run.status);
  const runIssues = project.issues.filter(issue => issue.runId === run.id);
  const unresolvedRunIssues = runIssues.filter(issue => !['verified', 'closed'].includes(issue.status));
  const scenarioEvidenceCount = run.scenarioIds.filter(id => run.scenarioResults?.[id]?.evidence || run.scenarioResults?.[id]?.attachments?.length).length;

  const start = () => {
    if (!canStart) {
      setStartAttempted(true);
      document.querySelector('.session-sidebar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    store.startTestRun(project.id, run.id);
  };
  const selectRoute = selectedRouteId => {
    store.updateTestRun(project.id, run.id, { routeId: selectedRouteId });
    if (selectedRouteId && !project.routeIds.includes(selectedRouteId)) store.assignRoutesToProject(project.id, [selectedRouteId]);
  };

  const submitForReview = () => {
    const incomplete = run.scenarioIds.length - completedScenarios;
    if (incomplete && !window.confirm(`仍有 ${incomplete} 个场景未形成结论。提交后现场记录将进入只读复核状态，是否继续？`)) return;
    store.submitTestRun(project.id, run.id);
  };
  const approve = () => {
    if (!run.reviewer.trim()) return alert('请填写复核人。');
    const warnings = [];
    if (completedScenarios < run.scenarioIds.length) warnings.push(`${run.scenarioIds.length - completedScenarios} 个场景无结论`);
    if (scenarioEvidenceCount < run.scenarioIds.length) warnings.push(`${run.scenarioIds.length - scenarioEvidenceCount} 个场景无证据索引`);
    if (unresolvedRunIssues.length) warnings.push(`${unresolvedRunIssues.length} 个关联问题未关闭`);
    if (warnings.length && !window.confirm(`当前仍有：${warnings.join('、')}。是否仍批准归档？`)) return;
    store.approveTestRun(project.id, run.id, { reviewer: run.reviewer, reviewNotes: run.reviewNotes });
  };
  const returnForRework = () => {
    if (!run.reviewer.trim()) return alert('请填写复核人。');
    if (!run.reviewNotes.trim()) return alert('退回前请填写复核意见。');
    store.returnTestRun(project.id, run.id, { reviewer: run.reviewer, reviewNotes: run.reviewNotes });
  };
  const addCheckpoint = () => {
    setCheckpointBusy(true);
    const save = coords => { store.addRunCheckpoint(project.id, run.id, { label: checkpointNote.trim() || '现场记录', notes: checkpointNote.trim(), ...coords }); setCheckpointNote(''); setCheckpointBusy(false); };
    if (!navigator.geolocation) return save({});
    navigator.geolocation.getCurrentPosition(position => save({ lat: position.coords.latitude, lon: position.coords.longitude }), () => save({}), { enableHighAccuracy: true, timeout: 8000 });
  };

  return <div className="test-session-page">
    <header className="session-header">
      <div><Link to={`/projects/${project.id}/runs`}>← 返回项目</Link><span>LIVE TEST SESSION</span><h1>{run.name}</h1><p>{project.name} · {profile.name}</p></div>
      <div className="session-header-actions"><StatusBadge value={run.status} labels={RUN_LABELS} /><Button onClick={() => navigate(`/projects/${project.id}/runs`)}>编辑任务</Button>{route?.googleUrl && <a className="button button-secondary button-md" href={route.googleUrl} target="_blank" rel="noreferrer">打开导航 ↗</a>}</div>
    </header>

    <section className="session-command-bar">
      <div><span>执行计时</span><strong>{formatDuration(elapsed)}</strong><small>{run.startedAt ? `开始于 ${new Date(run.startedAt).toLocaleTimeString('zh-CN')}` : '尚未开始'}</small></div>
      <div><span>路线</span><strong>{route?.name || '未分配路线'}</strong><small>{route ? `${((route.stats?.distance || 0) / 1000).toFixed(1)} km · ${route.stops.length} 个途经点` : '返回任务编辑页分配路线'}</small></div>
      <div><span>场景完成</span><strong>{completedScenarios}/{run.scenarioIds.length}</strong><ProgressBar value={run.scenarioIds.length ? completedScenarios / run.scenarioIds.length * 100 : 0} tone="green" /></div>
      <div><span>行前检查</span><strong>{checklistDone}/{run.checklist.length}</strong><ProgressBar value={checklistDone / run.checklist.length * 100} /></div>
      <div className="session-controls">{['planned', 'ready', 'paused'].includes(run.status) && <Button variant="primary" onClick={start}>{canStart ? (run.status === 'paused' ? '继续测试' : '开始测试') : `解除阻塞 · ${startBlockers.length} 项`}</Button>}{run.status === 'running' && <><Button onClick={() => store.pauseTestRun(project.id, run.id)}>暂停</Button><Button variant="primary" onClick={submitForReview}>结束并提交复核</Button></>}{run.status === 'review' && <Button variant="primary" onClick={() => document.querySelector('.review-decision-card')?.scrollIntoView({ behavior: 'smooth' })}>处理工程复核</Button>}{run.status === 'completed' && <Button onClick={() => { const retry = store.duplicateTestRun(project.id, run.id); if (retry) navigate(`/projects/${project.id}/runs`); }}>创建重测任务</Button>}</div>
    </section>
    {!canStart && ['planned', 'ready', 'paused'].includes(run.status) && <div className={`session-warning ${startAttempted ? 'attention' : ''}`}><strong>开始前还需解除 {startBlockers.length} 项阻塞：</strong><span>{startBlockers.join('、')}</span></div>}
    {run.status === 'cancelled' && <div className="session-warning"><strong>任务已取消。</strong><span>如需继续测试，请在项目中创建新的执行任务。</span></div>}

    {run.status === 'review' && <Card className="review-decision-card" title="工程复核关口" subtitle="现场数据已冻结；批准后才同步到项目场景矩阵并计入完成里程">
      <div className="review-summary"><span><small>场景结论</small><strong>{completedScenarios}/{run.scenarioIds.length}</strong></span><span><small>证据覆盖</small><strong>{scenarioEvidenceCount}/{run.scenarioIds.length}</strong></span><span><small>关联问题</small><strong className={unresolvedRunIssues.length ? 'text-danger' : ''}>{unresolvedRunIssues.length}</strong></span><span><small>实测里程</small><strong>{run.distance || 0} km</strong></span></div>
      <div className="form-grid"><label className="field"><span>复核人</span><input value={run.reviewer} onChange={event => store.updateTestRun(project.id, run.id, { reviewer: event.target.value })} /></label><label className="field span-2"><span>复核意见 / 退回原因</span><textarea rows="3" value={run.reviewNotes} onChange={event => store.updateTestRun(project.id, run.id, { reviewNotes: event.target.value })} placeholder="记录证据完整性、数据质量、异常说明和批准依据" /></label></div>
      <div className="toolbar-row"><Button variant="primary" onClick={approve}>批准并归档</Button><Button variant="danger" onClick={returnForRework}>退回补测</Button></div>
    </Card>}

    <div className="session-layout">
      <main className="session-main">
        <Card title="测试场景执行" subtitle="每个结论将随任务完成同步回项目场景矩阵">
          {!run.scenarioIds.length ? <EmptyState title="任务未分配测试场景" description="返回任务编辑页选择本次需要执行的法规或工程场景。" /> : <div className="live-scenario-list">{run.scenarioIds.map((id, index) => <LiveScenarioCard key={id} index={index} project={project} run={run} scenario={COMPLIANCE_SCENARIOS[id]} store={store} readOnly={!fieldWorkEditable} />)}</div>}
        </Card>
        <Card title="现场时间线" subtitle="记录关键道路事件、问题位置、测试边界和临时决策">
          <div className="checkpoint-composer"><input disabled={!fieldWorkEditable} value={checkpointNote} onChange={event => setCheckpointNote(event.target.value)} placeholder={fieldWorkEditable ? '例如：进入可变限速区，现场标志 80 km/h' : '开始或继续任务后可记录现场事件'} /><Button disabled={!fieldWorkEditable || checkpointBusy || !checkpointNote.trim()} onClick={addCheckpoint}>{checkpointBusy ? '定位中…' : '记录当前事件'}</Button></div>
          {!run.checkpoints.length ? <EmptyState title="暂无现场记录" description="记录时会尝试保存当前时间与 GPS 坐标。" /> : <div className="checkpoint-list">{run.checkpoints.map(item => <article key={item.id}><time>{new Date(item.timestamp).toLocaleTimeString('zh-CN')}</time><i /><div><strong>{item.label}</strong><span>{item.lat != null ? `${item.lat.toFixed(5)}, ${item.lon.toFixed(5)}` : '未获取坐标'}</span></div>{fieldWorkEditable && <button onClick={() => store.deleteRunCheckpoint(project.id, run.id, item.id)}>×</button>}</article>)}</div>}
        </Card>
        <EvidenceManager readOnly={!fieldWorkEditable} projectId={project.id} ownerType="run" ownerId={run.id} attachments={run.attachments} onChange={attachments => store.updateTestRun(project.id, run.id, { attachments })} />
      </main>

      <aside className="session-sidebar">
        <Card title="行前检查" subtitle="全部完成后才能开始道路测试">
          <div className="preflight-list">{run.checklist.map(item => <label key={item.id} className={item.checked ? 'checked' : ''}><input type="checkbox" disabled={!['planned', 'ready', 'paused'].includes(run.status)} checked={item.checked} onChange={event => store.toggleRunChecklist(project.id, run.id, item.id, event.target.checked)} /><span>{item.checked ? '✓' : ''}</span><strong>{item.label}</strong></label>)}</div>
        </Card>
        <Card title="任务配置与环境" subtitle="可在现场工作台直接补齐任务，不必返回项目页">
          <div className="session-fields"><label><span>测试路线</span><select disabled={configurationLocked} value={run.routeId} onChange={event => selectRoute(event.target.value)}><option value="">请选择路线</option>{routes.map(item => <option key={item.id} value={item.id}>{item.name}{project.routeIds.includes(item.id) ? '' : '（选择后加入项目）'}</option>)}</select></label><label><span>驾驶员</span><input disabled={configurationLocked} value={run.driver} onChange={event => store.updateTestRun(project.id, run.id, { driver: event.target.value })} /></label><label><span>车辆 / 软件版本</span><input disabled={configurationLocked} value={run.vehicle} onChange={event => store.updateTestRun(project.id, run.id, { vehicle: event.target.value })} /></label><label><span>天气 / 路况</span><input disabled={recordLocked} value={run.weather} onChange={event => store.updateTestRun(project.id, run.id, { weather: event.target.value })} /></label><div className="odometer-fields"><label><span>开始里程表</span><input disabled={recordLocked} type="number" value={run.startOdometer ?? ''} onChange={event => store.updateTestRun(project.id, run.id, { startOdometer: event.target.value === '' ? null : Number(event.target.value) })} /></label><label><span>结束里程表</span><input disabled={recordLocked} type="number" value={run.endOdometer ?? ''} onChange={event => store.updateTestRun(project.id, run.id, { endOdometer: event.target.value === '' ? null : Number(event.target.value) })} /></label></div><label><span>任务备注</span><textarea disabled={recordLocked} rows="3" value={run.notes} onChange={event => store.updateTestRun(project.id, run.id, { notes: event.target.value })} /></label></div>
        </Card>
        <Card title="路线地图" subtitle={route ? route.name : '未分配路线'} className="session-map-card"><div className="session-map"><MapCanvas /></div>{route && <div className="toolbar-row"><Button size="sm" onClick={() => useRoutePlannerStore.getState().locateRoute(route.id)}>重新定位</Button><Button size="sm" onClick={() => useRoutePlannerStore.getState().exportRouteGpx(route.id)}>导出 GPX</Button></div>}</Card>
        <div className="session-safety"><strong>安全边界</strong><p>公共道路测试不得主动制造危险场景。驾驶员始终对车辆控制与当地交通法规负责；高风险动作应在封闭或受控环境中执行。</p></div>
      </aside>
    </div>
  </div>;
}

function LiveScenarioCard({ index, project, run, scenario, store, readOnly = false }) {
  const result = run.scenarioResults?.[scenario.id] || {};
  const update = (field, value) => store.setRunScenarioResult(project.id, run.id, scenario.id, { [field]: value });
  const createIssue = () => {
    const issue = store.createIssueFromRun(project.id, run.id, scenario.id, { title: `${scenario.name}：现场异常`, description: result.notes || '' });
    if (issue) update('status', result.status === 'not_started' ? 'failed' : result.status || 'failed');
  };
  return <article className={`live-scenario-card result-${result.status || 'not_started'}`}>
    <header><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{scenario.name}</strong><small>{scenario.category} · 目标 {scenario.targetLabel || '人工验证'}</small></div><select disabled={readOnly} value={result.status || 'not_started'} onChange={event => update('status', event.target.value)}>{TEST_STATUSES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></header>
    <p>{scenario.objective}</p>
    <div className="live-scenario-fields"><label><span>现场结论与现象</span><textarea disabled={readOnly} rows="2" value={result.notes || ''} onChange={event => update('notes', event.target.value)} placeholder={scenario.evidenceHint} /></label><label><span>外部证据索引</span><input disabled={readOnly} value={result.evidence || ''} onChange={event => update('evidence', event.target.value)} placeholder="日志 ID、视频编号或本地文件索引" /></label></div>
    <EvidenceManager compact readOnly={readOnly} projectId={project.id} ownerType="scenario" ownerId={`${run.id}:${scenario.id}`} attachments={result.attachments || []} onChange={attachments => update('attachments', attachments)} />
    <footer><span>{(result.issueIds || []).length} 个关联问题</span>{!readOnly && <Button size="sm" variant="danger" onClick={createIssue}>登记问题</Button>}</footer>
  </article>;
}

function formatDuration(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours, minutes, rest].map(value => String(value).padStart(2, '0')).join(':');
}
