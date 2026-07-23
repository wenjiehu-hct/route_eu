import { useEffect, useState } from 'react';
import { buildTopRoadsText, remoteSuggest } from '../services/routing.js';
import { formatHours, formatKm, formatPercent } from '../services/utils.js';
import { useRoutePlannerStore } from '../stores/useRoutePlannerStore.js';
import { useCoveragePlannerStore } from '../stores/useCoveragePlannerStore.js';
import { useComplianceStore } from '../stores/useComplianceStore.js';
import { Button, Card, EmptyState } from './ui.jsx';

export default function ManualRoute() {
  const store = useRoutePlannerStore();
  const [query, setQuery] = useState('');
  const [remoteSuggestions, setRemoteSuggestions] = useState([]);
  const [searchState, setSearchState] = useState('');
  const complianceProjectId = useCoveragePlannerStore(state => state.complianceProjectId);
  const localSuggestions = query.trim() ? store.localSuggest(query) : [];
  const suggestions = [...localSuggestions, ...remoteSuggestions.filter(remote => !localSuggestions.some(local => Math.abs(local.lat - remote.lat) < 1e-5 && Math.abs(local.lon - remote.lon) < 1e-5))].slice(0, 10);
  const addSuggestion = item => { store.addStopToDraft(item); setQuery(''); };
  useEffect(() => {
    const value = query.trim();
    if (value.length < 3 || localSuggestions.length >= 6) {
      const resetTimer = setTimeout(() => { setRemoteSuggestions([]); setSearchState(''); }, 0);
      return () => clearTimeout(resetTimer);
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearchState('searching');
      try { setRemoteSuggestions(await remoteSuggest(value, { signal: controller.signal })); setSearchState('done'); }
      catch (error) { if (error.name !== 'AbortError') setSearchState('error'); }
    }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    const route = await store.saveDraftRoute();
    if (route && complianceProjectId) {
      useComplianceStore.getState().assignRoutesToProject(complianceProjectId, [route.id]);
      useRoutePlannerStore.getState().setStatus(`已保存路线“${route.name}”并加入当前测试项目。`);
    }
  };
  return <div className="stack-lg">
    <Card title={store.draft.id ? '编辑路线' : '手工路线'} subtitle="搜索城市、输入坐标，或直接在地图上点击添加途经点">
      {complianceProjectId && <div className="notice notice-blue context-notice"><span>项目规划模式：新保存的路线会自动加入当前测试项目。</span><Button size="sm" onClick={() => useCoveragePlannerStore.getState().clearComplianceContext()}>退出项目模式</Button></div>}
      <div className="form-grid">
        <label className="field span-2"><span>路线名称</span><input value={store.draft.name} onChange={event => store.setDraftField('name', event.target.value)} placeholder="例如：慕尼黑 ISA 城郊基准路线" /></label>
        <label className="field"><span>保存分组</span><select value={store.draft.groupId || ''} onChange={event => store.setDraftField('groupId', event.target.value)}>{store.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <label className="field"><span>地图选点</span><Button variant={store.mapPickEnabled ? 'primary' : 'secondary'} onClick={() => store.setMapPickEnabled(!store.mapPickEnabled)}>{store.mapPickEnabled ? '正在选点' : '启用选点'}</Button></label>
      </div>
      <div className="search-box"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索城市或输入 48.137, 11.576" />{query && <button onClick={() => setQuery('')}>×</button>}</div>
      {searchState === 'searching' && <div className="search-status">正在搜索 OpenStreetMap 地名库…</div>}
      {searchState === 'error' && <div className="search-status error">在线地名搜索暂不可用，仍可输入坐标或使用本地城市库。</div>}
      {!!suggestions.length && <div className="suggestion-menu">{suggestions.map((item, index) => <button key={`${item.name}-${index}`} onClick={() => addSuggestion(item)}><div><strong>{item.name}</strong><small>{item.full || item.source}</small></div><span>{Number(item.lat).toFixed(5)}, {Number(item.lon).toFixed(5)}</span></button>)}</div>}
      {!store.draft.stops.length ? <EmptyState icon="＋" title="尚未添加途经点" description="至少添加两个点才能生成路线。" /> : <div className="stop-list">{store.draft.stops.map((stop, index) => <article key={`${stop.name}-${index}`}><span>{index + 1}</span><div><strong>{stop.name}</strong><small>{Number(stop.lat).toFixed(5)}, {Number(stop.lon).toFixed(5)}</small></div><Button size="sm" disabled={!index} onClick={() => store.moveDraftStop(index, -1)}>↑</Button><Button size="sm" disabled={index === store.draft.stops.length - 1} onClick={() => store.moveDraftStop(index, 1)}>↓</Button><Button size="sm" variant="danger" onClick={() => store.removeDraftStop(index)}>删除</Button></article>)}</div>}
      <div className="toolbar-row"><Button variant="primary" disabled={store.draft.stops.length < 2 || !store.draft.name.trim()} onClick={save}>{store.draft.id ? '保存修改' : '保存路线'}</Button><Button onClick={store.refreshDraftPreview} disabled={store.draft.stops.length < 2}>刷新预览</Button><Button variant="ghost" onClick={store.resetDraft}>清空草稿</Button></div>
    </Card>
    <Card title="路线预览" subtitle="基于 OSRM 实际道路几何计算">
      {store.draftPreview.loading && <div className="loading-state"><span className="spinner" />正在计算路线...</div>}
      {store.draftPreview.warning && <div className="notice notice-danger">{store.draftPreview.warning}</div>}
      {!store.draftPreview.loading && !store.draftPreview.warning && !store.draftPreview.stats && <EmptyState title="等待路线计算" description="添加两个以上途经点后自动生成预览。" />}
      {store.draftPreview.stats && <RoutePreview stats={store.draftPreview.stats} />}
    </Card>
  </div>;
}

function RoutePreview({ stats }) {
  return <><div className="kpi-grid"><span><small>总里程</small><strong>{formatKm(stats.distance)}</strong></span><span><small>预计时间</small><strong>{formatHours(stats.duration)}</strong></span><span><small>高速</small><strong>{formatKm(stats.motorwayDistance)} · {formatPercent(stats.share.motorway)}</strong></span><span><small>城市</small><strong>{formatKm(stats.urbanDistance)} · {formatPercent(stats.share.urban)}</strong></span></div><div className="notice notice-blue"><strong>主要道路：</strong>{buildTopRoadsText(stats)}</div></>;
}
