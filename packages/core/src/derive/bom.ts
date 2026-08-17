/**
 * BOM generation (spec §6.4). Walks every component, wire, and covering
 * reference, skips `excludeFromBom`, groups by `partId` (or a synthetic
 * "unassigned" bucket per component/wire type so missing parts still show
 * up as a reviewable line rather than silently vanishing).
 *
 * SCAFFOLD-LEVEL SIMPLIFICATIONS vs. the full spec §6.4 table — each is a
 * deliberate, flagged gap, not an oversight:
 *   - Connector configuration accessories (lock/dustCover/backshell/boot)
 *     are NOT yet rolled up. Needs `ConnectorConfiguration` lookup by
 *     `component.configurationId`; deferred until a real fixture exercises
 *     configurations (spec §14 already flags this as unconfirmed in
 *     practice).
 *   - Cavity contacts/seals ARE rolled up (populated cavity → contact,
 *     empty cavity → seal), since `Cavity.contactPartId`/`sealPartId` are
 *     already in the type model and cheap to walk.
 *   - Coverings are counted (qty 1 per occurrence) rather than priced by
 *     covered length, since `coveringIds` lives on the covered *component*,
 *     not on a length-bearing span (spec §4.4 — partial-span coverings are
 *     an open question, spec §14).
 */

import type { HarnessDocument, LengthResult, BomLine, Part } from '../types.js';
import type { WireId, PartId } from '../ids.js';
import { fromMicrometres } from '../units.js';

const UNASSIGNED = '__unassigned__';

interface Accumulator {
  key: string;
  partId?: PartId;
  quantity: number;
  unit: BomLine['unit'];
  refdes: Set<string>;
  warnings: Set<string>;
}

export function computeBom(doc: HarnessDocument, lengths: Map<WireId, LengthResult>): BomLine[] {
  const acc = new Map<string, Accumulator>();

  const add = (partId: PartId | undefined, refdes: string, quantity: number, unit: BomLine['unit'], warning?: string) => {
    const key = partId ?? `${UNASSIGNED}:${unit}`;
    if (!acc.has(key)) {
      acc.set(key, { key, partId, quantity: 0, unit, refdes: new Set(), warnings: new Set() });
    }
    const entry = acc.get(key)!;
    entry.quantity += quantity;
    entry.refdes.add(refdes);
    if (warning) entry.warnings.add(warning);
    if (!partId) entry.warnings.add('no part assigned');
  };

  const populatedCavityKeys = collectPopulatedCavities(doc);

  for (const component of Object.values(doc.components)) {
    if (component.excludeFromBom) continue;

    switch (component.type) {
      case 'connector':
        add(component.partId, component.refdes, 1, 'ea');
        for (const cavity of component.cavities) {
          const populated = populatedCavityKeys.has(`${component.id}:${cavity.id}`);
          if (populated && cavity.contactPartId) add(cavity.contactPartId, component.refdes, 1, 'ea');
          if (!populated && cavity.sealPartId) add(cavity.sealPartId, component.refdes, 1, 'ea');
        }
        for (const coveringId of component.coveringIds ?? []) {
          add(coveringId, component.refdes, 1, 'ea', 'covering quantity is a per-occurrence count, not covered length (spec §6.4 simplification)');
        }
        break;
      case 'splice':
      case 'terminal':
      case 'resistor':
      case 'diode':
      case 'cable':
      case 'generic':
        add(component.partId, component.refdes, 1, 'ea');
        for (const coveringId of component.coveringIds ?? []) {
          add(coveringId, component.refdes, 1, 'ea', 'covering quantity is a per-occurrence count, not covered length (spec §6.4 simplification)');
        }
        break;
      case 'branchPoint':
        // Not a purchasable item.
        break;
    }
  }

  // Shields (spec follow-up: WireGroup.shield) — one BOM line per shielded
  // group, keyed like everything else by the shield's own PartId so
  // multiple groups sharing the same catalog shield roll up together.
  //
  // …except when the shield's `model` says it isn't a purchased line item.
  // 'ipc620WireTermination' documents the braid as an assembly operation
  // against the conductor rather than a separate part (IPC/WHMA-A-620), and
  // 'custom' means the user is describing it by hand and hasn't asked this
  // tool to assert a rollup either way. Emitting a phantom "(unassigned)"
  // line for either would be the BOM inventing a purchase order.
  for (const group of Object.values(doc.wireGroups)) {
    const shield = group.shield;
    if (!shield) continue;
    const model = shield.model ?? 'standalonePart';
    if (model !== 'standalonePart') continue;
    add(shield.partId, group.refdes ?? group.id, 1, 'ea');
  }

  for (const [wireId, wire] of Object.entries(doc.wires)) {
    const result = lengths.get(wireId);
    const status = result?.status ?? 'unplaced';
    const valueMm = result ? fromMicrometres(result.value, doc.settings.lengthUnit) : 0;
    const warning =
      status === 'lowerBound'
        ? 'length is a lower bound'
        : status === 'noRoute'
          ? 'no route — length excluded from total'
          : undefined;
    const quantity = status === 'noRoute' || status === 'unplaced' ? 0 : valueMm;
    add(wire.partId, wire.refdes, quantity, doc.settings.lengthUnit, warning);
  }

  return [...acc.values()].map((entry) => toBomLine(doc, entry));
}

function collectPopulatedCavities(doc: HarnessDocument): Set<string> {
  const keys = new Set<string>();
  for (const wire of Object.values(doc.wires)) {
    for (const endpoint of [wire.source, wire.target]) {
      if (endpoint.kind === 'cavity') keys.add(`${endpoint.componentId}:${endpoint.cavityId}`);
    }
  }
  return keys;
}

function toBomLine(doc: HarnessDocument, entry: Accumulator): BomLine {
  const part: Part | undefined = entry.partId ? doc.parts[entry.partId] : undefined;
  const unitPrice = part ? ('pricePerMeter' in part ? part.pricePerMeter ?? part.price : part.price) : undefined;
  const quantity = round2(entry.quantity);
  return {
    partId: entry.partId,
    partNumber: part?.partNumber ?? '(unassigned)',
    manufacturer: part?.manufacturer ?? '',
    vendorPartNumber: part?.vendorPartNumber,
    description: part?.description ?? '',
    quantity,
    unit: entry.unit,
    unitPrice,
    extendedPrice: unitPrice !== undefined ? round2(unitPrice * quantity) : undefined,
    url: part?.url,
    parameters: part?.parameters,
    refdes: [...entry.refdes].sort(),
    warnings: [...entry.warnings],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
