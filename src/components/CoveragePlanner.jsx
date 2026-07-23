import { useState } from 'react';
import { getCoverageDerived, useCoveragePlannerStore } from '../stores/useCoveragePlannerStore.js';
import { useRoutePlannerStore } from '../stores/useRoutePlannerStore.js';
import { formatKm, formatPercent } from '../services/utils.js';
import { Button, Card, Chip, ProgressBar } from './ui.jsx';

const ROAD_LABELS = { motorway: '高速', trunk: '快速路', primary: '主干道', secondary: '次干道', tertiary: '支路', residential: '居住区', unclassified: '未分类', other: '其他' };

export default function CoveragePlanner() {
  const store = useCoveragePlannerStore();
  const groups = useRoutePlannerStore(state => state.groups);
  const [groupId, setGroupId] = useState(groups[0]?.id || '');
  const derived = getCoverageDerived(store);
  const effectiveGroupId = groups.some(group => group.id === groupId) ? groupId : groups[0]?.id || '';
  const selectedCount = store.previewSegments.filter(segment => segment.selected).length;
  const setNumber = (key, value) => store.setOption(key, Number(value));

  return <Card title="选区覆盖路线生成" subtitle="专项批量能力：在任意多边形内生成 4–5 条长路线，优先低重复和道路差异">
    {store.complianceProjectId && <div className="notice notice-blue context-notice"><span>法规项目模式已启用：保存后的路线会自动加入当前测试项目。</span><Button size="sm" onClick={store.clearComplianceContext}>退出项目模式</Button></div>}
    <div className="section-block">
      <div className="section-label">道路类型</div>
      <div className="check-grid">
        {store.highwayTypeOptions.map(option => <label key={option.value} className="check-pill"><input type="checkbox" checked={store.roadTypes.includes(option.value)} onChange={event => store.setOption('roadTypes', event.target.checked ? [...store.roadTypes, option.value] : store.roadTypes.filter(value => value !== option.value))} /><span>{option.label}</span></label>)}
      </div>
      <label className="switch-row"><span>包含匝道和连接道路</span><input type="checkbox" checked={store.includeLinks} onChange={event => store.setOption('includeLinks', event.target.checked)} /></label>
    </div>

    <div className="metric-form">
      <label><span>路线数量</span><input type="number" min="4" max="5" value={store.routeCount} onChange={event => setNumber('routeCount', event.target.value)} /><small>条</small></label>
      <label><span>单条目标里程</span><input type="number" min="10" max="150" step="5" value={store.maxSegmentKm} onChange={event => setNumber('maxSegmentKm', event.target.value)} /><small>km</small></label>
      <label><span>关键点最小间距</span><input type="number" min="100" max="1000" step="50" value={store.sampleSpacingMeters} onChange={event => setNumber('sampleSpacingMeters', event.target.value)} /><small>m</small></label>
    </div>
    <p className="helper">系统只保留指定数量的优质候选路线，优先长度、低重复、道路类型差异和转弯平滑度。</p>

    <div className="toolbar-row">
      {(store.mode === 'idle' || store.mode === 'preview') && <Button variant="primary" onClick={store.startDrawing}>绘制测试区域</Button>}
      {store.mode === 'drawn' && <Button onClick={store.startDrawing}>重新绘制</Button>}
      {store.mode === 'drawing' && <Button onClick={store.cancelDrawing}>取消绘制</Button>}
      {store.mode !== 'idle' && <Button variant="ghost" onClick={store.clearAll}>清空</Button>}
    </div>

    {store.mode === 'drawing' && <div className="notice">单击添加顶点；双击、Enter 或点击首个顶点完成。Backspace 撤销，Esc 取消。</div>}
    {store.polygon.length >= 3 && store.mode !== 'drawing' && <div className="summary-strip"><Chip>{store.polygon.length} 个顶点</Chip><Chip>{derived.areaKm2.toFixed(1)} km²</Chip><Chip>软边界 {derived.edgeBufferMeters}m</Chip>{derived.queryAreaKm2 > derived.areaLimitKm2 && <Chip tone="danger">查询范围超过 {derived.areaLimitKm2} km²</Chip>}</div>}
    {store.mode === 'drawn' && <Button variant="primary" className="full-button" disabled={!derived.canGenerate} onClick={store.generate}>生成精选路线</Button>}
    {store.mode === 'generating' && <div className="generation-progress"><ProgressBar value={store.progress.percent} /><div><span>{store.progress.message}</span><strong>{store.progress.percent}%</strong></div><Button size="sm" onClick={store.abort}>中断</Button></div>}
    {store.progress.phase === 'error' && <div className="notice notice-danger">{store.progress.message}</div>}

    {store.mode === 'preview' && <div className="preview-panel">
      <div className="section-heading"><div><strong>候选路线</strong><span>勾选决定是否保存；显示状态只影响地图</span></div><div><Button size="sm" onClick={() => store.setAllSegmentsVisible(true)}>全显</Button><Button size="sm" onClick={() => store.setAllSegmentsVisible(false)}>全隐</Button></div></div>
      <div className="coverage-kpis"><span><small>区域内道路</small><strong>{formatKm(store.stats.insideCoveredMeters)}</strong></span><span><small>框外衔接</small><strong>{formatKm(store.stats.outsideMeters)}</strong></span><span><small>综合重复</small><strong>{formatPercent(store.stats.duplicationRatio)}</strong></span></div>
      <div className="route-candidates">
        {store.previewSegments.map(segment => <article key={segment.id} className={`candidate-row ${segment.selected ? 'selected' : ''}`}>
          <input type="checkbox" checked={segment.selected} onChange={() => store.toggleSegmentSelected(segment.id)} />
          <i style={{ background: segment.color }} />
          <button className="candidate-main" onClick={() => store.locateSegment(segment.id)}><strong>{segment.name}</strong><span>{formatKm(segment.stats?.distance || segment.estimatedMeters)} · 重复 {formatKm((segment.deadheadMeters || 0) + (segment.crossOverlapMeters || 0))}</span><small>{roadTypes(segment)}</small></button>
          <div className="candidate-actions"><Button size="sm" onClick={() => store.toggleSegmentVisible(segment.id)}>{segment.visible === false ? '显示' : '隐藏'}</Button><Button size="sm" variant="ghost" onClick={() => store.showOnlySegment(segment.id)}>仅看</Button></div>
        </article>)}
      </div>
      <div className="save-bar"><select value={effectiveGroupId} onChange={event => setGroupId(event.target.value)}>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select><Button variant="primary" disabled={!selectedCount} onClick={() => store.saveSelected(effectiveGroupId)}>保存 {selectedCount} 条路线</Button></div>
    </div>}
  </Card>;
}

function roadTypes(segment) {
  return Object.entries(segment.roadTypeDistances || {}).filter(([, distance]) => distance > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([type, distance]) => `${ROAD_LABELS[type.replace(/_link$/, '')] || type} ${formatKm(distance)}`).join(' · ');
}
