// src/components/bills/BillEditFields.tsx
//
// The form primitives the bill editor is built from, and the one piece of shared
// vocabulary that makes the editor honest: every field states whether it is an
// EDITABLE SOURCE VALUE or a CALCULATED ONE.
//
// WHY THE DISTINCTION IS VISIBLE
// The invoice's numbers come from two different places. The identifiers, the
// recipient, the transport, the bank details, the terms, the tax RATES and the round
// off are what a person decided and may correct. Every line amount, every total and
// (unless overridden) the amount in words are arithmetic on the above. A form that
// showed both as ordinary inputs would invite a user to "fix" a total that is
// correct, and the fix would be silently overwritten on save. So the calculated
// block is rendered read-only and labelled as calculated, and the one derived field a
// user may legitimately want to control — the amount in words — is a separate,
// explicit control.

import type { ReactNode } from "react";

export const inputCls =
  "w-full px-3 py-2 rounded-lg bg-bg border border-border text-sm text-text placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all disabled:opacity-60 disabled:cursor-not-allowed";

export const labelCls = "block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1";

/** One labelled field. `hint` sits under the control rather than in a tooltip. */
export function Field({
  label,
  children,
  hint,
  wide,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <label className={labelCls}>{label}</label>
      {children}
      {hint && <p className="text-[11px] text-text-muted mt-1 leading-snug">{hint}</p>}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
  type = "text",
  inputMode,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: string;
  inputMode?: "text" | "numeric" | "decimal" | "email";
  id?: string;
}) {
  return (
    <input
      id={id}
      type={type}
      inputMode={inputMode}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={inputCls}
    />
  );
}

/**
 * A number held as TEXT while it is being typed.
 *
 * Not `type="number"`. That control silently discards a character as soon as the
 * remaining text is not a valid number, so typing "1." or clearing the field to type
 * a new value makes the keystroke vanish and the input impossible to edit. The text
 * is parsed on save, where an unparseable value is a message rather than a lost
 * keystroke.
 */
export function NumberInput({
  value,
  onChange,
  placeholder,
  disabled,
  align = "left",
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  align?: "left" | "right";
  id?: string;
}) {
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputCls} ${align === "right" ? "text-right tabular-nums" : "tabular-nums"}`}
    />
  );
}

export function TextArea({
  value,
  onChange,
  rows = 3,
  placeholder,
  disabled,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <textarea
      id={id}
      rows={rows}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputCls} resize-y leading-relaxed`}
    />
  );
}

/** One titled group of fields. */
export function SectionCard({
  title,
  description,
  children,
  cols = 2,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  cols?: 1 | 2 | 3;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface overflow-hidden">
      <header className="px-4 py-3 border-b border-border bg-bg-secondary">
        <h3 className="text-sm font-bold text-text">{title}</h3>
        {description && <p className="text-xs text-text-muted mt-0.5 leading-snug">{description}</p>}
      </header>
      <div
        className={`p-4 grid gap-3 ${cols === 1 ? "grid-cols-1" : cols === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2"}`}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * A figure the system derives, shown read-only.
 *
 * `ReadOnly` rather than a disabled input, because a greyed-out box still looks like
 * something that could be enabled, and the label says what will actually happen:
 * these are recomputed from the line items and the rates when the bill is saved.
 */
export function Calculated({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div>
      <span className={labelCls}>{label}</span>
      <div
        className={`px-3 py-2 rounded-lg bg-bg-secondary border border-border text-sm tabular-nums ${
          strong ? "font-bold text-text" : "text-text-secondary"
        }`}
      >
        {value}
      </div>
    </div>
  );
}