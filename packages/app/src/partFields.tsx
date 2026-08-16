/**
 * Shared "common part fields" form — Connor: "For each component add the
 * following as entry fields in the properties tab (which should translate
 * to the parts library and BOM automatically): manf PN, vendor PN, link,
 * cost (per unit length for wire), max rating (with selectable units
 * depending on what the max value is for that part)."
 *
 * One reusable block instead of duplicating five inputs in every place a
 * Part gets edited (SchematicCanvas's per-component Properties tab, the
 * wire-properties popup, WireGroup cable/shield sections, and BomPane's
 * parts-library editor) — every one of those already lazily creates/updates
 * a `Part` the same way (see each call site's own `ensure...Part` helper),
 * so this only needs a `part` to read and an `onUpdate` to write through.
 *
 * `partNumber`/`manufacturer`/`url`/`price` already existed on `PartBase`
 * before this follow-up (they were just never surfaced outside the
 * connector's own Properties tab or the parts-library form) — only
 * `vendorPartNumber` and `maxRating` are new fields on the data model
 * (see PartBase in core/types.ts).
 */

import type { MaxRatingUnit, Part } from '@openharness/core';
import { theme } from './theme.js';

export const MAX_RATING_UNITS: { value: MaxRatingUnit; label: string }[] = [
  { value: 'V', label: 'V (voltage)' },
  { value: 'A', label: 'A (current)' },
  { value: 'W', label: 'W (power)' },
  { value: 'ohm', label: 'Ω (resistance)' },
  { value: 'degC', label: '°C (temperature)' },
  { value: 'degF', label: '°F (temperature)' },
];

export function PartCommonFields({
  part, onUpdate, costLabel = 'Cost',
}: {
  part: Part | undefined;
  onUpdate: (mutate: (p: Part) => void) => void;
  /** e.g. "Cost (per unit length)" for WirePart — the BOM already treats a
   * wire's `price` as $/lengthUnit since wire BOM quantity is authored in
   * the document's length unit (see bom.ts), so no separate field is
   * needed — just a label that says so where it might not be obvious. */
  costLabel?: string;
}) {
  return (
    <div style={s.grid}>
      <Field label="Manf PN">
        <input
          style={s.input} value={part?.partNumber ?? ''}
          onChange={(e) => { const v = e.target.value; onUpdate((p) => { p.partNumber = v || undefined; }); }}
        />
      </Field>
      <Field label="Manufacturer">
        <input
          style={s.input} value={part?.manufacturer ?? ''}
          onChange={(e) => { const v = e.target.value; onUpdate((p) => { p.manufacturer = v || undefined; }); }}
        />
      </Field>
      <Field label="Vendor PN">
        <input
          style={s.input} value={part?.vendorPartNumber ?? ''}
          onChange={(e) => { const v = e.target.value; onUpdate((p) => { p.vendorPartNumber = v || undefined; }); }}
        />
      </Field>
      <Field label="Link">
        <input
          style={s.input} value={part?.url ?? ''} placeholder="https://…"
          onChange={(e) => { const v = e.target.value; onUpdate((p) => { p.url = v || undefined; }); }}
        />
      </Field>
      <Field label={costLabel}>
        <input
          style={s.input} type="number" step="0.01" value={part?.price ?? ''}
          onChange={(e) => { const v = e.target.value; onUpdate((p) => { p.price = v ? Number(v) : undefined; }); }}
        />
      </Field>
      <Field label="Max rating" span2>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            style={{ ...s.input, flex: 1.4 }} type="number" step="any" placeholder="value"
            value={part?.maxRating?.value ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              onUpdate((p) => {
                if (!v) { p.maxRating = undefined; return; }
                p.maxRating = { value: Number(v), unit: p.maxRating?.unit ?? 'V' };
              });
            }}
          />
          <select
            style={{ ...s.input, flex: 1 }} value={part?.maxRating?.unit ?? 'V'}
            onChange={(e) => {
              const unit = e.target.value as MaxRatingUnit;
              onUpdate((p) => { p.maxRating = { value: p.maxRating?.value ?? 0, unit }; });
            }}
          >
            {MAX_RATING_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </div>
      </Field>
    </div>
  );
}

function Field({ label, span2, children }: { label: string; span2?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ ...s.fieldWrap, ...(span2 ? { gridColumn: '1 / -1' } : undefined) }}>
      <span style={s.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

const s = {
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  fieldWrap: { display: 'flex', flexDirection: 'column', gap: 3 },
  fieldLabel: { fontSize: 11, color: theme.color.textFaint, fontWeight: 500 },
  input: { padding: '6px 8px', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control, fontSize: 12.5, background: theme.color.surface, color: theme.color.textStrong, boxSizing: 'border-box', width: '100%' },
} satisfies Record<string, React.CSSProperties>;
