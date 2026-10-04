import { useEffect, useRef } from 'react';
import { STATUS_META } from '../lib/format.js';

const TONES = {
  neutral: 'bg-paper text-muted ring-line',
  accent: 'bg-accent-soft text-accent ring-accent/25',
  warn: 'bg-warn-soft text-warn ring-warn/25',
  bad: 'bg-bad-soft text-bad ring-bad/25',
  good: 'bg-good-soft text-good ring-good/25',
  info: 'bg-info-soft text-info ring-info/25',
};

export function Badge({ tone = 'neutral', children, className = '' }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]} ${className}`}>{children}</span>;
}

export function StatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status, tone: 'neutral' };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

const BTN = {
  primary: 'bg-accent text-white hover:bg-[#095a4e] disabled:bg-accent/40',
  secondary: 'bg-surface text-ink ring-1 ring-inset ring-line hover:bg-paper disabled:text-muted/60',
  danger: 'bg-bad text-white hover:bg-[#962016] disabled:bg-bad/40',
  ghost: 'text-accent hover:bg-accent-soft disabled:text-muted/60',
};

export function Spinner({ className = 'size-4' }) {
  return (
    <svg className={`spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Button({ variant = 'primary', loading = false, disabled, children, className = '', ...rest }) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${BTN[variant]} ${className}`}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Card({ title, subtitle, actions, children, className = '', padded = true }) {
  return (
    <section className={`rounded-lg border border-line bg-surface ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
            {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, tone = 'neutral', hint }) {
  const color = { neutral: 'text-ink', good: 'text-good', bad: 'text-bad', warn: 'text-warn', accent: 'text-accent', info: 'text-info' }[tone];
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="text-sm text-muted">{label}</div>
      <div className={`tnum mt-0.5 text-2xl font-semibold ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Alert({ tone = 'info', title, children, onDismiss, action }) {
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-md px-4 py-3 text-sm ring-1 ring-inset ${TONES[tone]}`}>
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={title ? 'mt-0.5 text-ink/80' : ''}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="rounded px-1.5 text-lg leading-none text-current/70 hover:text-current">
          ×
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
      <div className="text-sm font-semibold">{title}</div>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingBlock({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted" role="status">
      <Spinner /> {label}
    </div>
  );
}

export function Code({ children, className = '' }) {
  return <pre className={`overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-paper px-3 py-2 font-mono text-xs leading-relaxed ${className}`}>{children}</pre>;
}

export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', tone = 'primary', busy = false, onConfirm, onCancel }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}
      onClick={(e) => { if (e.target === ref.current && !busy) onCancel(); }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40"
    >
      {open && (
        <div className="p-5">
          <h2 className="text-base font-semibold">{title}</h2>
          <div className="mt-2 text-sm text-ink/80">{children}</div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
            <Button variant={tone} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
          </div>
        </div>
      )}
    </dialog>
  );
}

export const Table = ({ children }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[40rem] border-collapse text-left text-sm">{children}</table>
  </div>
);
export const Th = ({ children, className = '' }) => <th className={`border-b border-line bg-paper/60 px-3 py-2 text-xs font-semibold text-muted ${className}`}>{children}</th>;
export const Td = ({ children, className = '', ...rest }) => <td className={`border-b border-line px-3 py-2 align-top ${className}`} {...rest}>{children}</td>;

export const ConfidenceBadge = ({ level }) => <Badge tone={{ high: 'good', medium: 'warn', low: 'bad' }[level] || 'neutral'}>{level ? level[0].toUpperCase() + level.slice(1) : '-'}</Badge>;
export const SeverityBadge = ({ level }) => <Badge tone={{ high: 'bad', medium: 'warn', low: 'neutral' }[level] || 'neutral'}>{level}</Badge>;
