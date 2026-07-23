export function Card({ title, subtitle, actions, className = '', children }) {
  return <section className={`card ${className}`}>
    {(title || actions) && <header className="card-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="card-actions">{actions}</div>}</header>}
    <div className="card-body">{children}</div>
  </section>;
}

export function Button({ variant = 'secondary', size = 'md', className = '', children, ...props }) {
  return <button className={`button button-${variant} button-${size} ${className}`} {...props}>{children}</button>;
}

export function Chip({ tone = 'neutral', children }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function ProgressBar({ value = 0, tone = 'blue' }) {
  return <div className="progress-track"><i className={`progress-${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

export function EmptyState({ icon = '◇', title, description, action }) {
  return <div className="empty-state"><span className="empty-symbol">{icon}</span><strong>{title}</strong>{description && <p>{description}</p>}{action}</div>;
}

export function Field({ label, className = '', children }) {
  return <label className={`field ${className}`}><span>{label}</span>{children}</label>;
}

export function PageHeader({ eyebrow, title, description, actions, children }) {
  return <header className="page-header">
    <div className="page-heading">{eyebrow && <span>{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}{children}</div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>;
}

export function StatCard({ label, value, detail, tone = 'blue', icon = '·', trend }) {
  return <article className={`stat-card stat-${tone}`}>
    <div className="stat-icon">{icon}</div>
    <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
    {trend && <em>{trend}</em>}
  </article>;
}

export function StatusBadge({ value, labels = {}, tone }) {
  const autoTone = tone || ({ completed: 'green', passed: 'green', verified: 'green', closed: 'green', running: 'blue', investigating: 'blue', planning: 'neutral', planned: 'neutral', paused: 'amber', blocked: 'amber', failed: 'red', critical: 'red', high: 'amber' })[value] || 'neutral';
  return <Chip tone={autoTone}>{labels[value] || value || '未设置'}</Chip>;
}
