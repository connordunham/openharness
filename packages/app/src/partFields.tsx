/**
 * Shared "common part fields" form — Connor: "For each component add the
 * following as entry fields in the properties tab (which should translate
 * to the parts library and BOM automatically): manf PN, vendor PN, link,
 * cost (per unit length for wire)."
 *
 * One reusable block instead of duplicating inputs in every place a Part
 * gets edited (SchematicCanvas's per-component Properties tab, the
 * wire-properties popup, WireGroup cable/shield sections, and BomPane's
 * parts-library editor) — every one of those already lazily creates/updates
 * a `Part` the same way (see each call site's own `ensure...Part` helper),
 * so this only needs a `part` to read and an `onUpdate` to write through.
 *
 * The former single "Max rating" value+unit pair is now the repeatable
 * parameter list below (Connor: "replace the single `maxRating` field with a
 * repeatable list of `{value, type: min/max/nom/typ...}` parameters,
 * user-extensible") — see PartParameter in core/types.ts for why one slot
 * wasn't enough.
 */

import type { Parasitics, Part, PartParameter, ParameterQualifier } from '@openharness/core';
import { PARAMETER_QUALIFIERS, newInstanceId } from '@openharness/core';
import { theme } from './theme.js';

/**
 * Unit suggestions offered by the parameter editor's combo box. This is a
 * SUGGESTION list, not a validation list — `PartParameter.unit` is a free
 * string precisely so a user can type whatever their datasheet says, which
 * is what "user-extensible" has to mean here. The `<datalist>` below offers
 * these without constraining input.
 */
export const PARAMETER_UNITS = [
  'V', 'A', 'W', 'Ω', 'mΩ', 'F', 'pF', 'nF', 'H', 'µH',
  '°C', '°F', 'N', 'N·m', 'mm', 'in', 'AWG', 'mm²', 'cycles', 'hours', '%',
];

/** Common parameter names, offered the same suggest-don't-constrain way. */
export const PARAMETER_NAMES = [
  'Voltage rating', 'Current rating', 'Power rating', 'Operating temperature',
  'Contact resistance', 'Insulation resistance', 'Mating cycles', 'Crimp tensile',
  'Outer diameter', 'Bend radius',
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
    <>
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
      </div>
      <PartParametersEditor part={part} onUpdate={onUpdate} />
    </>
  );
}

/**
 * The repeatable parameter list. Each row is name / qualifier / value /
 * unit, with name and unit as suggest-don't-constrain combo boxes.
 *
 * Rows are keyed by `PartParameter.id` rather than by array index, which is
 * why the id exists at all: keying by index makes React reuse the DOM node
 * of a deleted row for its successor, so removing the first of three rows
 * leaves the focused input showing the wrong row's text.
 */
export function PartParametersEditor({
  part, onUpdate,
}: {
  part: Part | undefined;
  onUpdate: (mutate: (p: Part) => void) => void;
}) {
  const parameters = part?.parameters ?? [];

  const updateParam = (id: string, mutate: (param: PartParameter) => void) => {
    onUpdate((p) => {
      const target = p.parameters?.find((x) => x.id === id);
      if (target) mutate(target);
    });
  };

  const addParam = () => {
    onUpdate((p) => {
      if (!p.parameters) p.parameters = [];
      p.parameters.push({ id: newInstanceId(), name: '', qualifier: 'max', value: 0, unit: 'V' });
    });
  };

  const removeParam = (id: string) => {
    onUpdate((p) => {
      if (!p.parameters) return;
      p.parameters = p.parameters.filter((x) => x.id !== id);
      // Drop the array entirely once empty rather than leaving `[]` behind,
      // so a part that never had parameters and one that had them all
      // removed serialise identically — otherwise .ohd diffs show a
      // meaningless `"parameters": []` appearing and disappearing.
      if (p.parameters.length === 0) p.parameters = undefined;
    });
  };

  return (
    <div style={s.paramBlock}>
      <datalist id="oh-param-units">
        {PARAMETER_UNITS.map((u) => <option key={u} value={u} />)}
      </datalist>
      <datalist id="oh-param-names">
        {PARAMETER_NAMES.map((n) => <option key={n} value={n} />)}
      </datalist>

      <div style={s.paramHeader}>
        <span style={s.fieldLabel}>Parameters</span>
        <button style={s.paramAddBtn} onClick={addParam} title="Add a parameter">+ Parameter</button>
      </div>

      {parameters.length === 0 && (
        <div style={s.paramEmpty}>No parameters — add ratings, temperature ranges, anything the datasheet lists.</div>
      )}

      {parameters.map((param) => (
        <div key={param.id} style={s.paramRow}>
          <input
            style={{ ...s.input, flex: 2.2 }} list="oh-param-names" placeholder="name"
            value={param.name}
            onChange={(e) => { const v = e.target.value; updateParam(param.id, (p) => { p.name = v; }); }}
          />
          <select
            style={{ ...s.input, flex: 1 }} value={param.qualifier}
            onChange={(e) => {
              const v = e.target.value as ParameterQualifier;
              updateParam(param.id, (p) => { p.qualifier = v; });
            }}
          >
            {PARAMETER_QUALIFIERS.map((q) => <option key={q.value} value={q.value}>{q.label}</option>)}
          </select>
          <input
            style={{ ...s.input, flex: 1.2 }} type="number" step="any" placeholder="value"
            value={param.value}
            onChange={(e) => { const v = e.target.value; updateParam(param.id, (p) => { p.value = v === '' ? 0 : Number(v); }); }}
          />
          <input
            style={{ ...s.input, flex: 1 }} list="oh-param-units" placeholder="unit"
            value={param.unit}
            onChange={(e) => { const v = e.target.value; updateParam(param.id, (p) => { p.unit = v; }); }}
          />
          <button style={s.paramRemoveBtn} title="Remove parameter" onClick={() => removeParam(param.id)}>×</button>
        </div>
      ))}
    </div>
  );
}

/**
 * Parasitics editor (Connor: "add parasitics to all components — optional
 * resistance, capacitance and inductance, default zero and hidden in
 * Properties unless a 'show parasitics' checkbox is toggled").
 *
 * The caller owns the visibility decision (it reads
 * `settings.showParasitics`) and simply doesn't render this when hidden —
 * rather than this component rendering itself as `display: none`, which
 * would leave the inputs in the tab order and reachable by keyboard while
 * supposedly hidden.
 *
 * Empty is stored as `undefined`, not 0. The two are numerically identical
 * everywhere that sums parasitics, but they are different statements: 0 Ω is
 * "measured, negligible", blank is "not characterised". Writing a literal 0
 * into every component the moment the checkbox is ticked would turn an
 * untouched document into a document full of unearned measurements.
 */
export function ParasiticsFields({
  parasitics, onUpdate,
}: {
  parasitics: Parasitics | undefined;
  onUpdate: (mutate: (p: Parasitics) => void) => void;
}) {
  const num = (v: number | undefined) => (v === undefined ? '' : String(v));
  return (
    <div style={s.grid}>
      <Field label="Resistance (Ω)">
        <input
          style={s.input} type="number" step="any" placeholder="0"
          value={num(parasitics?.resistanceOhms)}
          onChange={(e) => { const v = e.target.value; onUpdate((p) => { p.resistanceOhms = v === '' ? undefined : Number(v); }); }}
        />
      </Field>
      <Field label="Capacitance (F)">
        <input
          style={s.input} type="number" step="any" placeholder="0"
          value={num(parasitics?.capacitanceFarads)}
          onChange={(e) => { const v = e.target.value; onUpdate((p) => { p.capacitanceFarads = v === '' ? undefined : Number(v); }); }}
        />
      </Field>
      <Field label="Inductance (H)" span2>
        <input
          style={s.input} type="number" step="any" placeholder="0"
          value={num(parasitics?.inductanceHenries)}
          onChange={(e) => { const v = e.target.value; onUpdate((p) => { p.inductanceHenries = v === '' ? undefined : Number(v); }); }}
        />
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
  paramBlock: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 },
  paramHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  paramEmpty: { fontSize: 11, color: theme.color.textFaint, fontStyle: 'italic' },
  paramRow: { display: 'flex', gap: 4, alignItems: 'center' },
  paramAddBtn: { fontSize: 11, padding: '3px 8px', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control, background: theme.color.surface, color: theme.color.textStrong, cursor: 'pointer' },
  paramRemoveBtn: { width: 20, height: 20, flexShrink: 0, border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control, background: theme.color.surface, color: theme.color.textFaint, cursor: 'pointer', lineHeight: 1, padding: 0 },
} satisfies Record<string, React.CSSProperties>;
