import { useState } from 'react';
import { usePOIStore } from '../stores/usePOIStore.js';
import { Button, Card, EmptyState } from './ui.jsx';

const TYPES = [{ value: 'parking', label: '停车场' }, { value: 'gas', label: '加油/充电' }, { value: 'rest', label: '休息区' }, { value: 'hotel', label: '酒店' }, { value: 'restaurant', label: '餐饮' }, { value: 'attraction', label: '测试地标' }, { value: 'other', label: '其他' }];
const EMPTY = { name: '', type: 'other', lat: '', lon: '', color: '#f59e0b', description: '' };

export default function POIEditor() {
  const store = usePOIStore();
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const edit = poi => { setEditingId(poi.id); setForm({ ...poi }); };
  const reset = () => { setEditingId(null); setForm(EMPTY); };
  const save = () => {
    const lat = Number(form.lat); const lon = Number(form.lon);
    if (!form.name.trim() || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const payload = { ...form, name: form.name.trim(), lat, lon };
    editingId ? store.updatePOI(editingId, payload) : store.addPOI(payload); reset();
  };
  return <div className="stack-lg"><Card title="测试标记点" subtitle="管理停车、加油、休息区、测试起点和问题复现位置">
    {!store.pois.length ? <EmptyState icon="◆" title="暂无标记点" description="添加常用测试设施或问题位置。" /> : <div className="poi-list">{store.pois.map(poi => <article key={poi.id} className={poi.visible ? '' : 'muted'}><input type="checkbox" checked={poi.visible} onChange={() => store.togglePOI(poi.id)} /><i style={{ background: poi.color }} /><button onClick={() => window.dispatchEvent(new CustomEvent('locate-poi', { detail: poi }))}><strong>{poi.name}</strong><span>{TYPES.find(type => type.value === poi.type)?.label || poi.type} · {Number(poi.lat).toFixed(4)}, {Number(poi.lon).toFixed(4)}</span></button><Button size="sm" onClick={() => edit(poi)}>编辑</Button><Button size="sm" variant="danger" onClick={() => store.removePOI(poi.id)}>删除</Button></article>)}</div>}
  </Card><Card title={editingId ? '编辑标记点' : '新增标记点'}>
    <div className="form-grid"><label className="field"><span>名称</span><input value={form.name} onChange={event => update('name', event.target.value)} /></label><label className="field"><span>类型</span><select value={form.type} onChange={event => update('type', event.target.value)}>{TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label><label className="field"><span>纬度</span><input type="number" step="0.00001" value={form.lat} onChange={event => update('lat', event.target.value)} /></label><label className="field"><span>经度</span><input type="number" step="0.00001" value={form.lon} onChange={event => update('lon', event.target.value)} /></label><label className="field"><span>颜色</span><input type="color" value={form.color} onChange={event => update('color', event.target.value)} /></label><label className="field span-2"><span>说明</span><textarea rows="3" value={form.description} onChange={event => update('description', event.target.value)} /></label></div>
    <div className="toolbar-row"><Button variant="primary" onClick={save}>保存标记点</Button>{editingId && <Button onClick={reset}>取消编辑</Button>}</div>
  </Card></div>;
}

