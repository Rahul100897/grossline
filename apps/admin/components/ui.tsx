// Shared presentational primitives — every page uses these; no page invents
// its own table (docs/phase-3.md task 3.1).
import type { ReactNode } from 'react';

export function PageHeader({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="mb-4">
      <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
      {sub ? <p className="text-slate">{sub}</p> : null}
    </div>
  );
}

export function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-baseline justify-between gap-3">
      <h2 className="text-[13px] font-semibold">{title}</h2>
      {right}
    </div>
  );
}

/** Bordered container; wide tables scroll horizontally inside it. */
export function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded border border-hairline bg-panel">{children}</div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return <table className="w-full border-collapse whitespace-nowrap text-[13px]">{children}</table>;
}

export function Th({ children, num = false }: { children?: ReactNode; num?: boolean }) {
  return (
    <th
      className={`border-b border-hairline px-3 py-1.5 text-[12px] font-medium text-slate ${num ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  );
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
  return (
    <td
      colSpan={colSpan}
      className={`border-b border-hairline px-3 py-1.5 group-last:border-b-0 ${num ? 'text-right' : 'text-left'} ${quiet ? 'text-slate' : ''}`}
    >
      {children}
    </td>
  );
}

export function Tr({ children }: { children: ReactNode }) {
  return <tr className="group hover:bg-hover">{children}</tr>;
}

/**
 * Absent stays absent: words, never a zero, never a dash that reads like
 * zero. Pass the reason so the reader knows WHY there is no number.
 */
export function Absent({ reason }: { reason: string }) {
  return <span className="text-[12px] italic text-slate">{reason}</span>;
}

export type BadgeTone = 'neutral' | 'attn' | 'good';

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  const tones: Record<BadgeTone, string> = {
    neutral: 'border-hairline bg-paper text-slate',
    attn: 'border-attn-line bg-attn-soft text-attn',
    good: 'border-good-line bg-good-soft text-good',
  };
  return (
    <span className={`inline-block rounded-[3px] border px-1.5 text-[11px] leading-[17px] ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function HealthDot({ health }: { health: string }) {
  const color =
    health === 'healthy' ? 'text-good' : health === 'unknown' ? 'text-slate' : 'text-attn';
  const label = health === 'unknown' ? 'never synced' : health;
  return (
    <span className={color}>
      ● {label}
    </span>
  );
}

/** The quiet numbers strip — four numbers, not a stat-tile wall. */
export function NumberStrip({
  items,
}: {
  items: { value: ReactNode; label: string; tone?: 'ink' | 'attn' | 'good' }[];
}) {
  return (
    <div className="flex flex-wrap gap-x-9 gap-y-3 border-b border-hairline pb-3.5 pt-1">
      {items.map((item) => (
        <div key={item.label} className="min-w-[120px]">
          <div
            className={`text-[21px] font-semibold tracking-tight ${
              item.tone === 'attn' ? 'text-attn' : item.tone === 'good' ? 'text-good' : ''
            }`}
          >
            {item.value}
          </div>
          <div className="text-[12px] text-slate">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Every page needs an empty state — quiet words in a panel, not a blank. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border border-hairline bg-panel px-4 py-6 text-slate">{children}</div>
  );
}

/** …and an error state. */
export function ErrorState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border border-attn-line bg-attn-soft px-4 py-3 text-attn">
      {children}
    </div>
  );
}
