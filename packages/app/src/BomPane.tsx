/**
 * BOM pane (spec follow-up request, "Page 1 (BOM)"): a real panel — not
 * just the read-only rollup on the Overview tab — that opens beside the
 * Schematic and shows every assignable thing in the document (components,
 * loose wires, and wire groups that are cables) with whether it has a real
 * Part behind it, plus a browsable/editable parts library underneath.
 *
 * "Assign a part" is a plain `<select>` of existing parts of the right
 * kind, with a "+ New part…" option that expands an inline creation form.
 * For connectors specifically, that creation form doubles as the "combo
 * import" flow Connor asked for (with a real reference screenshot): the
 * connector body plus its lock/dust-cover/backshell/boot/contact/cavity-seal
 * accessories all get created together in one submit, wired up as the new
 * connector's default configuration — the same accessory-slot shape as the
 * Properties tab's Configurations UI in SchematicCanvas.tsx, just reachable
 * from the parts-library side instead of a placed component's side.
 */

import { useCallback, useState } from 'react';
import type {
  HarnessStore, Component, Part, PartId, WireGroup, ConnectorConfiguration, GaugeUnit, MaxRatingUnit,
} from '@openharness/core';
import { newPartId, newInstanceId } from '@openharness/core';
import { theme } from './theme.js';
import { ComponentIcon } from './icons.js';
import { MAX_RATING_UNITS } from './partFields.js';

type PartKind = Part['kind'];

const PART_KINDS: PartKind[] = ['connector', 'wire', 'cable', 'shield', 'splice', 'terminal', 'resistor', 'diode', 'covering', 'accessory', 'generic'];

const PART_KIND_LABEL: Record<PartKind, string> = {
  connector: 'Connectors', wire: 'Wires', cable: 'Cables', shield: 'Shields', splice: 'Splices', terminal: 'Terminals',
  resistor: 'Resistors', diode: 'Diodes', covering: 'Coverings', accessory: 'Accessories', generic: 'Generic',
};

// Connor: "ensure all relevant features added to the connector objects
// also appear in the other components" — `generic` components previously
// had no entry here at all, so a plain "generic" component could never be
// assigned a part from the Assignments panel below (only from the Parts
// library section, and only if you already knew to create one). Every
// other component type maps to the identically-named Part kind.
const COMPONENT_PART_KIND: Partial<Record<Component['type'], PartKind>> = {
  connector: 'connector', splice: 'splice', terminal: 'terminal', resistor: 'resistor', diode: 'diode', cable: 'cable',
  generic: 'generic',
};

const ACCESSORY_SLOTS = [
  { key: 'lockPartId', label: 'Lock', type: 'lock' },
  { key: 'dustCoverPartId', label: 'Dust cover', type: 'dustCover' },
  { key: 'backshellPartId', label: 'Backshell', type: 'backshell' },
  { key: 'bootPartId', label: 'Boot', type: 'boot' },
  { key: 'contactPartId', label: 'Contact', type: 'contact' },
  { key: 'cavitySealPartId', label: 'Cavity seal', type: 'cavitySeal' },
] as const;

type AssignTarget =
  | { kind: 'component'; id: string; partKind: PartKind; refdes: string; typeLabel: string }
  | { kind: 'wire'; id: string; refdes: string }
  | { kind: 'group'; id: string; refdes: string };

function targetKey(t: AssignTarget): string {
  return `${t.kind}:${t.id}`;
}

function targetPartKind(t: AssignTarget): PartKind {
  return t.kind === 'component' ? t.partKind : t.kind === 'wire' ? 'wire' : 'cable';
}

interface NewPartFields {
  partNumber: string;
  manufacturer: string;
  vendorPartNumber: string;
  url: string;
  description: string;
  price: string;
  maxRatingValue: string;
  maxRatingUnit: MaxRatingUnit;
  gender: '' | 'male' | 'female' | 'hermaphroditic';
  color: string;
  hasShell: boolean;
  gaugeValue: string;
  gaugeUnit: GaugeUnit;
  accessoryType: string;
  coveringType: string;
  accessories: Record<string, string>;
}

const EMPTY_FIELDS: NewPartFields = {
  partNumber: '', manufacturer: '', vendorPartNumber: '', url: '', description: '', price: '',
  maxRatingValue: '', maxRatingUnit: 'V',
  gender: '', color: '', hasShell: false,
  gaugeValue: '', gaugeUnit: 'mm2',
  accessoryType: 'contact', coveringType: 'heatShrink',
  accessories: {},
};

interface BomPaneProps {
  store: HarnessStore;
  /** Cross-pane hover highlighting — only component-kind rows participate
   * (wires/cables don't have a shared id with Schematic/Layout nodes yet). */
  hoveredComponentId?: string | null;
  onHoverComponent?: (id: string | null) => void;
}

export function BomPane({ store, hoveredComponentId, onHoverComponent }: BomPaneProps) {
  const doc = store.doc;
  const [assignTargetKey, setAssignTargetKey] = useState<string | null>(null);
  const [libraryNewKind, setLibraryNewKind] = useState<PartKind | null>(null);
  const [expandedPartId, setExpandedPartId] = useState<string | null>(null);

  const partsOfKind = useCallback((kind: PartKind) => Object.values(doc.parts).filter((p) => p.kind === kind), [doc.parts]);

  const setTargetPartId = useCallback(
    (target: AssignTarget, partId: PartId | undefined) => {
      store.transact(partId ? 'Assign part' : 'Unassign part', (draft) => {
        if (target.kind === 'component') {
          const c = draft.components[target.id];
          if (c) c.partId = partId;
        } else if (target.kind === 'wire') {
          const w = draft.wires[target.id];
          if (w) w.partId = partId;
        } else {
          const g = draft.wireGroups[target.id];
          if (g) g.partId = partId;
        }
      });
    },
    [store],
  );

  const createPart = useCallback(
    (partKind: PartKind, fields: NewPartFields, target?: AssignTarget) => {
      store.transact('Add part', (draft) => {
        const partId = newPartId();
        const base = {
          id: partId,
          partNumber: fields.partNumber || undefined,
          manufacturer: fields.manufacturer || undefined,
          vendorPartNumber: fields.vendorPartNumber || undefined,
          url: fields.url || undefined,
          description: fields.description || undefined,
          price: fields.price ? Number(fields.price) : undefined,
          maxRating: fields.maxRatingValue ? { value: Number(fields.maxRatingValue), unit: fields.maxRatingUnit } : undefined,
          custom: {},
        };

        let part: Part;
        switch (partKind) {
          case 'connector': {
            const configurations: ConnectorConfiguration[] = [];
            const hasAnyAccessory = Object.values(fields.accessories).some((v) => !!v);
            if (hasAnyAccessory) {
              const cfg: ConnectorConfiguration = { id: newInstanceId(), name: 'Default' };
              for (const slot of ACCESSORY_SLOTS) {
                const pn = fields.accessories[slot.key];
                if (pn) {
                  const accessoryId = newPartId();
                  draft.parts[accessoryId] = { id: accessoryId, kind: 'accessory', accessoryType: slot.type, partNumber: pn, custom: {} };
                  (cfg as unknown as Record<string, string>)[slot.key] = accessoryId;
                }
              }
              configurations.push(cfg);
            }
            part = {
              ...base, kind: 'connector', numberOfCavities: 0, designationTemplate: { kind: 'numbers' },
              gender: fields.gender || undefined, color: fields.color || undefined, hasShell: fields.hasShell,
              configurations,
            };
            break;
          }
          case 'wire':
            part = { ...base, kind: 'wire', gauge: { value: Number(fields.gaugeValue) || 0.5, unit: fields.gaugeUnit }, color: fields.color || undefined };
            break;
          case 'cable':
            part = { ...base, kind: 'cable' };
            break;
          case 'shield':
            part = { ...base, kind: 'shield', shieldType: 'braid' };
            break;
          case 'splice':
            part = { ...base, kind: 'splice' };
            break;
          case 'terminal':
            part = { ...base, kind: 'terminal' };
            break;
          case 'resistor':
            part = { ...base, kind: 'resistor' };
            break;
          case 'diode':
            part = { ...base, kind: 'diode' };
            break;
          case 'covering':
            part = { ...base, kind: 'covering', coveringType: fields.coveringType as never, color: fields.color || undefined };
            break;
          case 'accessory':
            part = { ...base, kind: 'accessory', accessoryType: fields.accessoryType as never };
            break;
          case 'generic':
          default:
            part = { ...base, kind: 'generic' };
            break;
        }

        draft.parts[partId] = part;
        if (target) {
          if (target.kind === 'component') { const c = draft.components[target.id]; if (c) c.partId = partId; }
          else if (target.kind === 'wire') { const w = draft.wires[target.id]; if (w) w.partId = partId; }
          else { const g = draft.wireGroups[target.id]; if (g) g.partId = partId; }
        }
      });
      setAssignTargetKey(null);
      setLibraryNewKind(null);
    },
    [store],
  );

  const updatePart = useCallback(
    (partId: string, mutate: (p: Part) => void) => {
      store.transact('Edit part', (draft) => {
        const p = draft.parts[partId];
        if (p) mutate(p);
      });
    },
    [store],
  );

  const deletePart = useCallback(
    (partId: string) => {
      store.transact('Delete part', (draft) => {
        delete draft.parts[partId];
        for (const c of Object.values(draft.components)) if (c.partId === partId) c.partId = undefined;
        for (const w of Object.values(draft.wires)) if (w.partId === partId) w.partId = undefined;
        for (const g of Object.values(draft.wireGroups)) if (g.partId === partId) g.partId = undefined;
      });
      if (expandedPartId === partId) setExpandedPartId(null);
    },
    [store, expandedPartId],
  );

  const componentTargets: AssignTarget[] = Object.values(doc.components)
    .filter((c) => COMPONENT_PART_KIND[c.type])
    .map((c) => ({ kind: 'component', id: c.id, partKind: COMPONENT_PART_KIND[c.type]!, refdes: c.refdes, typeLabel: c.type }));

  const wireTargets: AssignTarget[] = Object.values(doc.wires)
    .filter((w) => !w.twistGroupId)
    .map((w) => ({ kind: 'wire', id: w.id, refdes: w.refdes }));

  const cableTargets: AssignTarget[] = Object.values(doc.wireGroups)
    .filter((g) => g.kind === 'cable')
    .map((g) => ({ kind: 'group', id: g.id, refdes: g.refdes ?? '(unnamed cable)' }));

  const getPartId = (t: AssignTarget): PartId | undefined =>
    t.kind === 'component' ? doc.components[t.id]?.partId : t.kind === 'wire' ? doc.wires[t.id]?.partId : (doc.wireGroups[t.id] as WireGroup | undefined)?.partId;

  const allTargets = [...componentTargets, ...wireTargets, ...cableTargets];
  const unassignedCount = allTargets.filter((t) => !getPartId(t)).length;

  return (
    <div style={s.pane}>
      <section style={s.panel}>
        <div style={s.panelHeaderRow}>
          <h3 style={s.panelTitle}>Assignments</h3>
          <span style={s.countChip(unassignedCount > 0)}>{unassignedCount === 0 ? 'all assigned' : `${unassignedCount} unassigned`}</span>
        </div>
        {allTargets.length === 0 ? (
          <p style={s.mutedNote}>Nothing to assign yet — add components or wires on the Schematic.</p>
        ) : (
          <div style={s.assignList}>
            {allTargets.map((t) => (
              <AssignRow
                key={targetKey(t)}
                target={t}
                doc={doc}
                partId={getPartId(t)}
                editing={assignTargetKey === targetKey(t)}
                onStartNew={() => setAssignTargetKey(targetKey(t))}
                onCancelNew={() => setAssignTargetKey(null)}
                onAssignExisting={(pid) => setTargetPartId(t, pid || undefined)}
                onCreate={(fields) => createPart(targetPartKind(t), fields, t)}
                partsOfKind={partsOfKind}
                isHovered={t.kind === 'component' && hoveredComponentId === t.id}
                onHover={t.kind === 'component' ? onHoverComponent : undefined}
              />
            ))}
          </div>
        )}
      </section>

      <section style={s.panel}>
        <h3 style={s.panelTitle}>Parts library</h3>
        {PART_KINDS.map((kind) => {
          const parts = partsOfKind(kind);
          return (
            <div key={kind} style={s.libraryGroup}>
              <div style={s.libraryGroupHeader}>
                <span style={s.libraryGroupLabel}>{PART_KIND_LABEL[kind]}</span>
                <span style={s.libraryGroupCount}>{parts.length}</span>
                <div style={{ flex: 1 }} />
                <button style={s.addPartBtn} onClick={() => setLibraryNewKind(libraryNewKind === kind ? null : kind)}>
                  {libraryNewKind === kind ? 'Cancel' : `+ Add ${PART_KIND_LABEL[kind].replace(/s$/, '')}`}
                </button>
              </div>
              {parts.length === 0 && libraryNewKind !== kind && <p style={s.mutedNoteSmall}>No {PART_KIND_LABEL[kind].toLowerCase()} yet.</p>}
              {parts.map((p) => (
                <PartLibraryRow
                  key={p.id}
                  part={p}
                  expanded={expandedPartId === p.id}
                  onToggle={() => setExpandedPartId(expandedPartId === p.id ? null : p.id)}
                  onUpdate={(mutate) => updatePart(p.id, mutate)}
                  onDelete={() => deletePart(p.id)}
                />
              ))}
              {libraryNewKind === kind && (
                <NewPartForm
                  kind={kind}
                  onCancel={() => setLibraryNewKind(null)}
                  onCreate={(fields) => createPart(kind, fields)}
                />
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function AssignRow({
  target, doc, partId, editing, onStartNew, onCancelNew, onAssignExisting, onCreate, partsOfKind, isHovered, onHover,
}: {
  target: AssignTarget;
  doc: HarnessStore['doc'];
  partId: PartId | undefined;
  editing: boolean;
  onStartNew: () => void;
  onCancelNew: () => void;
  onAssignExisting: (partId: string) => void;
  onCreate: (fields: NewPartFields) => void;
  partsOfKind: (kind: PartKind) => Part[];
  isHovered: boolean;
  onHover?: (id: string | null) => void;
}) {
  const kind = targetPartKind(target);
  const options = partsOfKind(kind);
  const icon = target.kind === 'component' ? (target.typeLabel as Component['type']) : 'cable';

  return (
    <div
      style={{ ...s.assignRowWrap, ...(isHovered ? s.assignRowHovered : undefined) }}
      onMouseEnter={() => onHover?.(target.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <div style={s.assignRow}>
        <span style={s.assignIcon}><ComponentIcon type={icon} size={14} /></span>
        <span style={s.assignRefdes}>{target.refdes}</span>
        <span style={s.assignTypeLabel}>{target.kind === 'component' ? target.typeLabel : target.kind === 'wire' ? 'wire' : 'cable'}</span>
        <div style={{ flex: 1 }} />
        <select
          style={s.assignSelect}
          value={editing ? '__new__' : (partId ?? '')}
          onChange={(e) => {
            if (e.target.value === '__new__') onStartNew();
            else onAssignExisting(e.target.value);
          }}
        >
          <option value="">— unassigned —</option>
          {options.length > 0 && (
            <optgroup label="Place from library">
              {options.map((p) => (
                <option key={p.id} value={p.id}>{p.partNumber || `(unnamed ${p.kind})`}{p.manufacturer ? ` — ${p.manufacturer}` : ''}</option>
              ))}
            </optgroup>
          )}
          <option value="__new__">+ Create new part…</option>
        </select>
      </div>
      {editing && (
        <NewPartForm kind={kind} onCancel={onCancelNew} onCreate={onCreate} />
      )}
      {void doc}
    </div>
  );
}

function NewPartForm({ kind, onCreate, onCancel }: { kind: PartKind; onCreate: (fields: NewPartFields) => void; onCancel: () => void }) {
  const [fields, setFields] = useState<NewPartFields>(EMPTY_FIELDS);
  const set = <K extends keyof NewPartFields>(key: K, value: NewPartFields[K]) => setFields((f) => ({ ...f, [key]: value }));

  return (
    <div style={s.newPartForm}>
      <div style={s.newPartGrid}>
        <Field label="Manf PN"><input style={s.input} value={fields.partNumber} onChange={(e) => set('partNumber', e.target.value)} /></Field>
        <Field label="Manufacturer"><input style={s.input} value={fields.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} /></Field>
        <Field label="Vendor PN"><input style={s.input} value={fields.vendorPartNumber} onChange={(e) => set('vendorPartNumber', e.target.value)} /></Field>
        <Field label="Link"><input style={s.input} placeholder="https://…" value={fields.url} onChange={(e) => set('url', e.target.value)} /></Field>
        <Field label="Description"><input style={s.input} value={fields.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label={kind === 'wire' ? 'Cost (per unit length)' : 'Cost'}><input style={s.input} type="number" step="0.01" value={fields.price} onChange={(e) => set('price', e.target.value)} /></Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Max rating">
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...s.input, flex: 1.4 }} type="number" step="any" placeholder="value" value={fields.maxRatingValue} onChange={(e) => set('maxRatingValue', e.target.value)} />
              <select style={{ ...s.input, flex: 1 }} value={fields.maxRatingUnit} onChange={(e) => set('maxRatingUnit', e.target.value as MaxRatingUnit)}>
                {MAX_RATING_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
          </Field>
        </div>

        {kind === 'connector' && (
          <>
            <Field label="Gender">
              <select style={s.input} value={fields.gender} onChange={(e) => set('gender', e.target.value as NewPartFields['gender'])}>
                <option value="">—</option>
                <option value="male">male</option>
                <option value="female">female</option>
                <option value="hermaphroditic">hermaphroditic</option>
              </select>
            </Field>
            <Field label="Color"><input style={s.input} value={fields.color} onChange={(e) => set('color', e.target.value)} /></Field>
            <label style={s.checkboxRow}>
              <input type="checkbox" checked={fields.hasShell} onChange={(e) => set('hasShell', e.target.checked)} /> Has shell
            </label>
          </>
        )}

        {kind === 'wire' && (
          <>
            <Field label="Gauge value"><input style={s.input} type="number" step="0.01" value={fields.gaugeValue} onChange={(e) => set('gaugeValue', e.target.value)} /></Field>
            <Field label="Gauge unit">
              <select style={s.input} value={fields.gaugeUnit} onChange={(e) => set('gaugeUnit', e.target.value as GaugeUnit)}>
                <option value="mm2">mm²</option>
                <option value="awg">AWG</option>
              </select>
            </Field>
            <Field label="Color"><input style={s.input} value={fields.color} onChange={(e) => set('color', e.target.value)} /></Field>
          </>
        )}

        {kind === 'covering' && (
          <Field label="Covering type">
            <select style={s.input} value={fields.coveringType} onChange={(e) => set('coveringType', e.target.value)}>
              <option value="heatShrink">Heat shrink</option>
              <option value="tape">Tape</option>
              <option value="corrugatedTubing">Corrugated tubing</option>
              <option value="spiralWrap">Spiral wrap</option>
              <option value="tubing">Tubing</option>
              <option value="braidedSleeve">Braided sleeve</option>
            </select>
          </Field>
        )}

        {kind === 'accessory' && (
          <Field label="Accessory type">
            <select style={s.input} value={fields.accessoryType} onChange={(e) => set('accessoryType', e.target.value)}>
              <option value="contact">Contact</option>
              <option value="lock">Lock</option>
              <option value="dustCover">Dust cover</option>
              <option value="backshell">Backshell</option>
              <option value="boot">Boot</option>
              <option value="cavitySeal">Cavity seal</option>
            </select>
          </Field>
        )}
      </div>

      {kind === 'connector' && (
        <>
          <div style={s.sectionLabel}>Related parts (creates the connector's default configuration)</div>
          <div style={s.accessoryGrid}>
            {ACCESSORY_SLOTS.map((slot) => (
              <Field key={slot.key} label={slot.label}>
                <input
                  style={s.input} placeholder="part number"
                  value={fields.accessories[slot.key] ?? ''}
                  onChange={(e) => set('accessories', { ...fields.accessories, [slot.key]: e.target.value })}
                />
              </Field>
            ))}
          </div>
        </>
      )}

      <div style={s.newPartActions}>
        <button style={s.cancelBtn} onClick={onCancel}>Cancel</button>
        <button style={s.createBtn} onClick={() => onCreate(fields)}>Create &amp; assign</button>
      </div>
    </div>
  );
}

function PartLibraryRow({
  part, expanded, onToggle, onUpdate, onDelete,
}: {
  part: Part;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (mutate: (p: Part) => void) => void;
  onDelete: () => void;
}) {
  return (
    <div style={s.libraryRow}>
      <div style={s.libraryRowHeader} onClick={onToggle}>
        <span style={s.libraryRowChevron}>{expanded ? '▾' : '▸'}</span>
        <span style={s.libraryRowPn}>{part.partNumber || '(unnamed part)'}</span>
        <span style={s.libraryRowMfr}>{part.manufacturer ?? ''}</span>
      </div>
      {expanded && (
        <div style={s.libraryRowBody}>
          <Field label="Manf PN"><input style={s.input} value={part.partNumber ?? ''} onChange={(e) => { const v = e.target.value; onUpdate((p) => { p.partNumber = v || undefined; }); }} /></Field>
          <Field label="Manufacturer"><input style={s.input} value={part.manufacturer ?? ''} onChange={(e) => { const v = e.target.value; onUpdate((p) => { p.manufacturer = v || undefined; }); }} /></Field>
          <Field label="Vendor PN"><input style={s.input} value={part.vendorPartNumber ?? ''} onChange={(e) => { const v = e.target.value; onUpdate((p) => { p.vendorPartNumber = v || undefined; }); }} /></Field>
          <Field label="Link"><input style={s.input} placeholder="https://…" value={part.url ?? ''} onChange={(e) => { const v = e.target.value; onUpdate((p) => { p.url = v || undefined; }); }} /></Field>
          <Field label="Description"><input style={s.input} value={part.description ?? ''} onChange={(e) => { const v = e.target.value; onUpdate((p) => { p.description = v || undefined; }); }} /></Field>
          <Field label={part.kind === 'wire' ? 'Cost (per unit length)' : 'Cost'}><input style={s.input} type="number" step="0.01" value={part.price ?? ''} onChange={(e) => { const v = e.target.value; onUpdate((p) => { p.price = v ? Number(v) : undefined; }); }} /></Field>
          <Field label="Max rating">
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ ...s.input, flex: 1.4 }} type="number" step="any" placeholder="value" value={part.maxRating?.value ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  onUpdate((p) => {
                    if (!v) { p.maxRating = undefined; return; }
                    p.maxRating = { value: Number(v), unit: p.maxRating?.unit ?? 'V' };
                  });
                }}
              />
              <select
                style={{ ...s.input, flex: 1 }} value={part.maxRating?.unit ?? 'V'}
                onChange={(e) => { const unit = e.target.value as MaxRatingUnit; onUpdate((p) => { p.maxRating = { value: p.maxRating?.value ?? 0, unit }; }); }}
              >
                {MAX_RATING_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
          </Field>
          <button style={s.deleteBtn} onClick={onDelete}>Delete part</button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={s.fieldWrap}>
      <span style={s.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

const s = {
  pane: { flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box' },
  panel: { border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.panel, padding: 18, background: theme.color.surface, boxShadow: theme.shadow.panel },
  panelHeaderRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  panelTitle: { margin: 0, fontSize: 13.5, fontWeight: 600, color: theme.color.textStrong },
  countChip: (warn: boolean) => ({
    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
    color: warn ? theme.color.warning : theme.color.textFaint,
    background: warn ? theme.color.warningSoft : theme.color.canvasBg,
  }),
  mutedNote: { color: theme.color.textMuted, fontSize: 13, margin: 0 },
  mutedNoteSmall: { color: theme.color.textFaint, fontSize: 12, margin: '4px 0 8px 0' },

  assignList: { display: 'flex', flexDirection: 'column', gap: 4 },
  assignRowWrap: { borderRadius: theme.radius.control, overflow: 'hidden', transition: 'background 0.1s' },
  assignRowHovered: { background: theme.color.warningSoft },
  assignRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px' },
  assignIcon: { color: theme.color.textMuted, display: 'flex', alignItems: 'center' },
  assignRefdes: { fontSize: 13, fontWeight: 600, color: theme.color.textStrong, minWidth: 40 },
  assignTypeLabel: { fontSize: 12, color: theme.color.textFaint },
  assignSelect: { fontSize: 12.5, padding: '5px 8px', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control, background: theme.color.surface, color: theme.color.textStrong, maxWidth: 260 },

  libraryGroup: { marginBottom: 14 },
  libraryGroupHeader: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${theme.color.border}` },
  libraryGroupLabel: { fontSize: 12.5, fontWeight: 600, color: theme.color.textStrong },
  libraryGroupCount: { fontSize: 11, color: theme.color.textFaint },
  addPartBtn: { fontSize: 11.5, padding: '4px 8px', border: `1px dashed ${theme.color.border}`, borderRadius: theme.radius.control, background: 'transparent', color: theme.color.textMuted, cursor: 'pointer' },

  libraryRow: { borderBottom: `1px solid ${theme.color.border}` },
  libraryRowHeader: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 2px', cursor: 'pointer' },
  libraryRowChevron: { fontSize: 10, color: theme.color.textFaint, width: 10 },
  libraryRowPn: { fontSize: 12.5, fontWeight: 500, color: theme.color.textStrong },
  libraryRowMfr: { fontSize: 12, color: theme.color.textFaint },
  libraryRowBody: { padding: '4px 2px 12px 18px', display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 },

  newPartForm: { marginTop: 6, marginBottom: 10, padding: 12, border: `1px dashed ${theme.color.border}`, borderRadius: theme.radius.control, background: theme.color.canvasBg },
  newPartGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  accessoryGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 6 },
  sectionLabel: { fontSize: 12, fontWeight: 600, color: theme.color.textStrong, marginTop: 14, marginBottom: 2 },
  fieldWrap: { display: 'flex', flexDirection: 'column', gap: 3 },
  fieldLabel: { fontSize: 11, color: theme.color.textFaint, fontWeight: 500 },
  input: { padding: '6px 8px', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control, fontSize: 12.5, background: theme.color.surface, color: theme.color.textStrong, boxSizing: 'border-box', width: '100%' },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: theme.color.textStrong, alignSelf: 'end', paddingBottom: 6 },
  newPartActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 },
  cancelBtn: { padding: '6px 12px', border: `1px solid ${theme.color.border}`, borderRadius: theme.radius.control, background: theme.color.surface, color: theme.color.textMuted, cursor: 'pointer', fontSize: 12.5 },
  createBtn: { padding: '6px 12px', border: `1px solid ${theme.color.accent}`, borderRadius: theme.radius.control, background: theme.color.accent, color: '#fff', cursor: 'pointer', fontSize: 12.5, fontWeight: 500 },
  deleteBtn: { alignSelf: 'flex-start', padding: '5px 10px', border: `1px solid ${theme.color.dangerBorder}`, borderRadius: theme.radius.control, background: theme.color.dangerSoft, color: theme.color.danger, cursor: 'pointer', fontSize: 12 },
} satisfies Record<string, React.CSSProperties | ((...args: never[]) => React.CSSProperties)>;
