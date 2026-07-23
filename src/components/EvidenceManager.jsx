import { useRef, useState } from 'react';
import { deleteEvidenceFile, downloadEvidenceFile, saveEvidenceFile } from '../services/evidenceStorage.js';
import { Button } from './ui.jsx';

export default function EvidenceManager({ projectId, ownerType, ownerId, attachments = [], onChange, compact = false }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const upload = async event => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length) return;
    setBusy(true); setMessage(`正在保存 ${files.length} 个附件…`);
    try {
      const saved = [];
      for (const file of files) saved.push(await saveEvidenceFile(file, { projectId, ownerType, ownerId }));
      onChange?.([...attachments, ...saved]);
      setMessage(`已保存 ${saved.length} 个附件到本机证据库。`);
    } catch (error) { setMessage(`附件保存失败：${error.message}`); }
    finally { setBusy(false); }
  };

  const download = async item => {
    try { setMessage('正在读取附件…'); await downloadEvidenceFile(item); setMessage('已开始下载附件。'); }
    catch (error) { setMessage(error.message); }
  };

  const remove = async item => {
    if (!window.confirm(`删除附件“${item.name}”？该操作会同时删除本机文件内容。`)) return;
    try { await deleteEvidenceFile(item.id); onChange?.(attachments.filter(value => value.id !== item.id)); setMessage('附件已删除。'); }
    catch (error) { setMessage(`删除失败：${error.message}`); }
  };

  return <section className={`evidence-manager ${compact ? 'compact' : ''}`}>
    <header><div><strong>证据附件</strong><span>视频、日志、图片、CAN 数据或现场记录</span></div><Button size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? '保存中…' : '＋ 添加附件'}</Button><input ref={inputRef} type="file" multiple hidden onChange={upload} /></header>
    {!!attachments.length && <div className="evidence-files">{attachments.map(item => <article key={item.id}><i>{fileKind(item)}</i><button onClick={() => download(item)}><strong>{item.name}</strong><span>{formatBytes(item.size)} · {new Date(item.createdAt).toLocaleString('zh-CN')}</span></button><button className="remove" onClick={() => remove(item)}>×</button></article>)}</div>}
    {!attachments.length && !compact && <p className="evidence-empty">附件保存在本机 IndexedDB。跨设备迁移时请从数据中心导出“工作区 + 证据目录”。</p>}
    {message && <small className={message.includes('失败') || message.includes('不存在') ? 'error' : ''}>{message}</small>}
  </section>;
}

function fileKind(item) {
  if (item.type?.startsWith('image/')) return 'IMG';
  if (item.type?.startsWith('video/')) return 'VID';
  if (item.type?.startsWith('audio/')) return 'AUD';
  if (/json|csv|text|log/.test(item.type || '') || /\.(json|csv|txt|log)$/i.test(item.name)) return 'LOG';
  return 'FILE';
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}
