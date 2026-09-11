// Shared presentational primitives — every page uses these; no page invents
// its own table (docs/phase-3.md task 3.1). Classes come from app/primitives.css,
// which is a verbatim port of the docs/design/*.html mockups (design port, Step B).
// No page styles its own table, tag or panel; these are the only source.
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function PageHeader({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="mb-4">
      <h1 className="gl-h1">{title}</h1>
      {sub ? <p className="gl-sub mt-1.5">{sub}</p> : null}
    </div>
  );
}

export function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-baseline justify-between gap-3">
      <h2 className="gl-section">{title}</h2>
      {right}
    </div>
  );
}

/** Bordered container; wide tables scroll horizontally inside it (see Table). */
export function Panel({ children }: { children: ReactNode }) {
  return <div className="gl-panel">{children}</div>;
}

/** Panel header — title on the left, meta/actions on the right (mockup .phead). */
export function PanelHeader({ title, right }: { title: ReactNode; right?: ReactNode }) {
  return (
    <div className="gl-phead">
      <h2>{title}</h2>
      {right ? <div className="gl-meta">{right}</div> : null}
    </div>
  );
}

/** Panel footnote strip (mockup .foot). */
export function PanelFoot({ children }: { children: ReactNode }) {
  return <div className="gl-foot">{children}</div>;
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="gl-tablewrap">
      <table className="gl-table">{children}</table>
    </div>
  );
}

export function Th({ children, num = false }: { children?: ReactNode; num?: boolean }) {
  return <th className={num ? 'gl-num' : undefined}>{children}</th>;
}

export function Td({
  children,
  num = false,
  quiet = false,
  colSpan,
}: {
  children?: ReactNode;
  num?: boolean;
  quiet?: boolean;
  colSpan?: number;
}) {
  const cls = [num ? 'gl-num' : '', quiet ? 'gl-quiet' : ''].filter(Boolean).join(' ');
  return (
    <td colSpan={colSpan} className={cls || undefined}>
      {children}
    </td>
  );
}

// Hover and last-row border come from the .gl-table CSS; a row is a plain <tr>.
export function Tr({ children }: { children: ReactNode }) {
  return <tr>{children}</tr>;
}

/**
 * Absent stays absent: words, never a zero, never a dash that reads like
 * zero. Pass the reason so the reader knows WHY there is no number.
 */
export function Absent({ reason }: { reason: string }) {
  return <span className="gl-absent">{reason}</span>;
}

// neutral → n, good → ok, attn → bad, warn → warn (mockup .tag variants).
export type BadgeTone = 'neutral' | 'attn' | 'good' | 'warn';

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  const cls: Record<BadgeTone, string> = {
    neutral: 'n',
    attn: 'bad',
    good: 'ok',
    warn: 'warn',
  };
  return <span className={`gl-tag ${cls[tone]}`}>{children}</span>;
}

export function HealthDot({ health }: { health: string }) {
  const tone = health === 'healthy' ? 'ok' : health === 'unknown' ? 'n' : 'bad';
  const label = health === 'unknown' ? 'never synced' : health;
  return (
    <span className="inline-flex items-center">
      <span className={`gl-sdot ${tone}`} />
      {label}
    </span>
  );
}

/** The quiet numbers strip — four numbers in a bordered grid (mockup .strip/.stat). */
export function NumberStrip({
  items,
}: {
  items: { value: ReactNode; label: string; tone?: 'ink' | 'attn' | 'good'; detail?: ReactNode }[];
}) {
  // gl-strip is a 4-up in the mockup; a count modifier (n1..n3) lets a 3- or
  // 2-stat strip render without an empty cell while keeping the mockup's mobile
  // reflow (a class, not inline style, so the @media rules still win).
  const count = items.length <= 3 ? ` n${items.length}` : '';
  return (
    <div className={`gl-strip${count}`}>
      {items.map((item) => (
        <div key={item.label} className="gl-stat">
          <div className="gl-k">{item.label}</div>
          <div
            className={`gl-v ${item.tone === 'attn' ? 'warn' : item.tone === 'good' ? 'good' : ''}`}
          >
            {item.value}
          </div>
          {item.detail ? <div className="gl-d">{item.detail}</div> : null}
        </div>
      ))}
    </div>
  );
}

/** Every page needs an empty state — quiet words in a panel, not a blank. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="gl-empty">{children}</div>;
}

/** …and an error state. */
export function ErrorState({ children }: { children: ReactNode }) {
  return <div className="gl-error">{children}</div>;
}

// ── Additional primitives for the report and merchant/admin pages (Steps C/D) ──

export type ButtonVariant = 'green' | 'ghost';

/** Button — mockup .btn / .btn.ghost / .btn.sm. */
export function Button({
  variant = 'green',
  sm = false,
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  sm?: boolean;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = ['gl-btn', variant === 'ghost' ? 'ghost' : '', sm ? 'sm' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}

/** A key/value list row (mockup .li). `right` is the muted right-hand note. */
export function ListRow({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="gl-li">
      <span>{children}</span>
      {right ? <span className="gl-r">{right}</span> : null}
    </div>
  );
}

/** A label/value mini row (mockup .mini / .mini.big). */
export function MiniRow({
  label,
  value,
  big = false,
}: {
  label: ReactNode;
  value: ReactNode;
  big?: boolean;
}) {
  return (
    <div className={`gl-mini ${big ? 'big' : ''}`}>
      <span>{label}</span>
      <span className="gl-v">{value}</span>
    </div>
  );
}

/** An issue/alert row with a coloured spine (mockup .issue + .fbar tone). */
export function IssueRow({
  title,
  children,
  meta,
  actions,
}: {
  title: ReactNode;
  children?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="gl-issue">
      <div className="gl-body">
        <h3>{title}</h3>
        {children ? <p>{children}</p> : null}
        {meta || actions ? (
          <div className="gl-m">
            {meta}
            {actions ? <div className="gl-act">{actions}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A settings row — label column + control column (mockup .srow). */
export function SettingsRow({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="gl-srow">
      <div>
        <h3>{title}</h3>
        {description ? <div className="gl-d">{description}</div> : null}
      </div>
      <div className="gl-c">{children}</div>
    </div>
  );
}

/** Progress track with a break-even marker (mockup .track/.fill/.be).
 *  `pct` and `breakEven` are 0–100. */
export function ProgressTrack({
  pct,
  breakEven,
  bad = false,
}: {
  pct: number;
  breakEven?: number;
  bad?: boolean;
}) {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  return (
    <span className="gl-track">
      <span className={`gl-fill ${bad ? 'bad' : ''}`} style={{ width: `${clamp(pct)}%` }} />
      {breakEven != null ? (
        <span className="gl-be" style={{ left: `${clamp(breakEven)}%` }} />
      ) : null}
    </span>
  );
}
