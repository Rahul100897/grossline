// Shared form primitives — same rules as the tables: dense, hairline borders,
// quiet labels, no page invents its own inputs.
import type { ReactNode } from 'react';

const inputClass =
  'rounded border border-hairline bg-panel px-2 py-1.5 text-[13px] text-ink outline-none focus:border-slate';

export function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  placeholder,
  required = false,
  hint,
  inputMode,
  maxLength,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  inputMode?: 'decimal' | 'text';
  maxLength?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-slate">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        inputMode={inputMode}
        maxLength={maxLength}
        className={inputClass}
      />
      {hint ? <span className="text-[11px] text-slate">{hint}</span> : null}
    </label>
  );
}

export function SelectField({
  label,
  name,
  options,
  defaultValue,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-slate">{label}</span>
      <select name={name} defaultValue={defaultValue} className={inputClass}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TextAreaField({
  label,
  name,
  defaultValue,
  rows = 10,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  rows?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-slate">{label}</span>
      <textarea name={name} defaultValue={defaultValue} rows={rows} className={inputClass} />
    </label>
  );
}

export function SubmitButton({ children }: { children: ReactNode }) {
  return (
    <button
      type="submit"
      className="rounded border border-ink bg-ink px-3 py-1.5 text-[13px] text-paper hover:bg-slate hover:border-slate"
    >
      {children}
    </button>
  );
}

/** ?saved=1 / ?error=... feedback line under a form. */
export function FormNotice({ saved, error }: { saved?: string; error?: string }) {
  if (error) {
    return (
      <p className="mb-3 rounded border border-attn-line bg-attn-soft px-3 py-2 text-[13px] text-attn">
        {decodeURIComponent(error)}
      </p>
    );
  }
  if (saved) {
    return (
      <p className="mb-3 rounded border border-good-line bg-good-soft px-3 py-2 text-[13px] text-good">
        Saved.
      </p>
    );
  }
  return null;
}
