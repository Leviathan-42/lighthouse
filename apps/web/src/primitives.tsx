// Lighthouse Primitives — Button, Card, StatusDot, Sparkline, DataTable, Badge, Kbd, Icon
import { useMemo } from 'react';
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  ReactNode,
} from 'react';
import type { ServiceStatus, Tone } from '@lighthouse/shared';

// ── StatusDot ───────────────────────────────────────────────────────────────
interface StatusDotProps {
  status?: ServiceStatus;
  pulse?: boolean;
  size?: number;
}

export function StatusDot({ status = 'ok', pulse = true, size = 8 }: StatusDotProps) {
  const color = {
    ok: 'var(--status-ok)',
    warn: 'var(--status-warn)',
    error: 'var(--status-error)',
    idle: 'var(--status-idle)',
    deploying: 'var(--accent)',
  }[status];
  return (
    <span
      aria-label={`status: ${status}`}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        boxShadow: pulse && status !== 'idle' ? `0 0 0 0 ${color}` : 'none',
        animation: pulse && status !== 'idle' ? `pulse-${status} 2s infinite` : 'none',
        flexShrink: 0,
      }}
    />
  );
}

// ── Button ──────────────────────────────────────────────────────────────────
type ButtonVariant = 'default' | 'ghost' | 'primary' | 'danger' | 'accent';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'size'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

export function Button({
  variant = 'default',
  size = 'md',
  icon,
  children,
  onClick,
  disabled,
  title,
  style,
  ...rest
}: ButtonProps) {
  const sizes: Record<ButtonSize, CSSProperties> = {
    sm: { padding: '4px 8px', fontSize: 11, height: 24, gap: 6 },
    md: { padding: '6px 12px', fontSize: 12, height: 30, gap: 6 },
    lg: { padding: '8px 16px', fontSize: 13, height: 36, gap: 8 },
  };
  const variants: Record<ButtonVariant, CSSProperties> = {
    default: { background: 'var(--bg-raised)', border: '1px solid var(--border-default)', color: 'var(--fg-primary)' },
    ghost: { background: 'transparent', border: '1px solid transparent', color: 'var(--fg-secondary)' },
    primary: { background: 'var(--accent)', border: '1px solid var(--accent)', color: 'var(--accent-fg)', fontWeight: 500 },
    danger: { background: 'transparent', border: '1px solid color-mix(in oklch, var(--status-error) 40%, transparent)', color: 'var(--status-error)' },
    accent: { background: 'var(--accent-glow)', border: '1px solid var(--border-accent)', color: 'var(--accent)' },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="lh-btn"
      data-variant={variant}
      style={{
        ...sizes[size],
        ...variants[variant],
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'var(--r-sm)',
        transition: 'background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)',
        whiteSpace: 'nowrap',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
      {...rest}
    >
      {icon && <span style={{ display: 'inline-flex' }}>{icon}</span>}
      {children}
    </button>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────
interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  glow?: boolean;
  padding?: number | string;
}

export function Card({ children, interactive, glow, padding = 16, style, ...rest }: CardProps) {
  return (
    <div
      className={`lh-card ${interactive ? 'interactive' : ''}`}
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--r-lg)',
        padding,
        transition:
          'border-color var(--dur-base) var(--ease-out), background var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-spring)',
        boxShadow: glow ? 'var(--glow-accent)' : 'none',
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

// ── Sparkline ───────────────────────────────────────────────────────────────
interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  live?: boolean;
  strokeWidth?: number;
}

export function Sparkline({
  data,
  width = 120,
  height = 28,
  color = 'var(--accent)',
  fill = true,
  live = false,
  strokeWidth = 1.25,
}: SparklineProps) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const points: Array<[number, number]> = data.map((v, i) => [
    i * step,
    height - ((v - min) / range) * (height - 4) - 2,
  ]);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ');
  const area = fill ? `${d} L ${width} ${height} L 0 ${height} Z` : '';
  const gradId = useMemo(() => `spark-${Math.random().toString(36).slice(2, 8)}`, []);
  const last = points[points.length - 1];
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gradId})`} />}
      <path d={d} stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {live && last && (
        <>
          <circle cx={last[0]} cy={last[1]} r="4" fill={color} opacity="0.2">
            <animate attributeName="r" values="3;7;3" dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.35;0;0.35" dur="1.6s" repeatCount="indefinite" />
          </circle>
          <circle cx={last[0]} cy={last[1]} r="2" fill={color} />
        </>
      )}
    </svg>
  );
}

// ── Badge ───────────────────────────────────────────────────────────────────
interface BadgeProps {
  children?: ReactNode;
  tone?: Tone;
  mono?: boolean;
  style?: CSSProperties;
}

export function Badge({ children, tone = 'neutral', mono = false, style }: BadgeProps) {
  const tones: Record<Tone, { bg: string; fg: string; bd: string }> = {
    neutral: { bg: 'var(--bg-overlay)', fg: 'var(--fg-secondary)', bd: 'var(--border-subtle)' },
    ok: { bg: 'var(--status-ok-bg)', fg: 'var(--status-ok)', bd: 'color-mix(in oklch, var(--status-ok) 30%, transparent)' },
    warn: { bg: 'var(--status-warn-bg)', fg: 'var(--status-warn)', bd: 'color-mix(in oklch, var(--status-warn) 30%, transparent)' },
    error: { bg: 'var(--status-error-bg)', fg: 'var(--status-error)', bd: 'color-mix(in oklch, var(--status-error) 30%, transparent)' },
    accent: { bg: 'var(--accent-glow)', fg: 'var(--accent)', bd: 'var(--border-accent)' },
  };
  const t = tones[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 7px',
        fontSize: 10,
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
        fontWeight: 500,
        letterSpacing: mono ? '-0.01em' : '0.02em',
        textTransform: mono ? 'none' : 'uppercase',
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.bd}`,
        borderRadius: 'var(--r-xs)',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// ── Kbd ─────────────────────────────────────────────────────────────────────
export function Kbd({ children }: { children?: ReactNode }) {
  return (
    <kbd
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 18,
        height: 18,
        padding: '0 4px',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        color: 'var(--fg-secondary)',
        background: 'var(--bg-overlay)',
        border: '1px solid var(--border-default)',
        borderBottomWidth: 2,
        borderRadius: 'var(--r-xs)',
      }}
    >
      {children}
    </kbd>
  );
}

// ── DataTable ───────────────────────────────────────────────────────────────
export interface Column<T> {
  header: string;
  key?: keyof T & string;
  align?: 'left' | 'right' | 'center';
  muted?: boolean;
  mono?: boolean;
  wrap?: boolean;
  render?: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  dense?: boolean;
}

export function DataTable<T extends { id?: string | number }>({
  columns,
  rows,
  onRowClick,
  dense = false,
}: DataTableProps<T>) {
  return (
    <div style={{ width: '100%', overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={i}
                style={{
                  textAlign: c.align || 'left',
                  padding: dense ? '6px 10px' : '9px 12px',
                  fontWeight: 500,
                  fontSize: 10,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--fg-tertiary)',
                  borderBottom: '1px solid var(--border-subtle)',
                  position: 'sticky',
                  top: 0,
                  background: 'var(--bg-raised)',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.id ?? i}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              style={{
                cursor: onRowClick ? 'pointer' : 'default',
                transition: 'background var(--dur-fast)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {columns.map((c, j) => (
                <td
                  key={j}
                  style={{
                    padding: dense ? '6px 10px' : '10px 12px',
                    textAlign: c.align || 'left',
                    borderBottom: '1px solid var(--border-subtle)',
                    color: c.muted ? 'var(--fg-secondary)' : 'var(--fg-primary)',
                    fontFamily: c.mono ? 'var(--font-mono)' : 'inherit',
                    whiteSpace: c.wrap ? 'normal' : 'nowrap',
                  }}
                >
                  {c.render ? c.render(r) : c.key ? (r[c.key] as ReactNode) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Icon set (minimal hand-drawn primitives — 16px stroke icons) ────────────
export const Icon = {
  Search: () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.25"/><path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/></svg>,
  ChevronRight: () => <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  ChevronDown: () => <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  ExternalLink: () => <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M10 3h3v3M13 3l-5 5M7 3H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Play: () => <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M4 3v10l9-5z"/></svg>,
  Pause: () => <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="3" height="10"/><rect x="9" y="3" width="3" height="10"/></svg>,
  Restart: () => <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8a5 5 0 1 0 1.5-3.5M3 3v3h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Terminal: () => <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="m3 5 3 3-3 3M7.5 11H13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Server: () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="3" width="11" height="4" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="2.5" y="9" width="11" height="4" rx="1" stroke="currentColor" strokeWidth="1.2"/><circle cx="5" cy="5" r="0.6" fill="currentColor"/><circle cx="5" cy="11" r="0.6" fill="currentColor"/></svg>,
  Grid: () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.5" width="4.5" height="4.5" stroke="currentColor" strokeWidth="1.2"/><rect x="9" y="2.5" width="4.5" height="4.5" stroke="currentColor" strokeWidth="1.2"/><rect x="2.5" y="9" width="4.5" height="4.5" stroke="currentColor" strokeWidth="1.2"/><rect x="9" y="9" width="4.5" height="4.5" stroke="currentColor" strokeWidth="1.2"/></svg>,
  Network: () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="3" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.2"/><circle cx="13" cy="3.5" r="1.5" stroke="currentColor" strokeWidth="1.2"/><circle cx="13" cy="12.5" r="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="m4.3 7.2 7.4-2.9M4.3 8.8l7.4 2.9" stroke="currentColor" strokeWidth="1.1"/></svg>,
  Deploy: () => <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2v10m0 0 3-3m-3 3-3-3M3 14h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Sparkle: () => <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 2v4M8 10v4M2 8h4M10 8h4M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>,
  Copy: () => <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2"/><path d="M3 10V4a1 1 0 0 1 1-1h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  Dot: () => <svg width="4" height="4" viewBox="0 0 4 4"><circle cx="2" cy="2" r="2" fill="currentColor"/></svg>,
  Check: () => <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  X: () => <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  Filter: () => <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 3h12l-4.5 5.5v4L6.5 14v-5.5L2 3Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>,
  Plus: () => <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
  Zap: () => <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M9 1 3 9h4l-1 6 6-8H8l1-6Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg>,
  Branch: () => <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="3" r="1.3" stroke="currentColor" strokeWidth="1.2"/><circle cx="4" cy="13" r="1.3" stroke="currentColor" strokeWidth="1.2"/><circle cx="12" cy="6" r="1.3" stroke="currentColor" strokeWidth="1.2"/><path d="M4 4.3v7.4M4 8c0-2 2-2 4-2h2.8" stroke="currentColor" strokeWidth="1.2"/></svg>,
};
