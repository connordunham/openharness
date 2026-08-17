import type { ShieldModel, ShieldTermination, ShieldType } from '@openharness/core';

/**
 * Shared shield vocabulary — used by both SchematicCanvas (where a shield is
 * created/edited, and where the termination mark renders) and LayoutCanvas
 * (Connor: "add details in the layout to specify shield termination
 * details" — a connector's shield terminations are now also visible/
 * editable from the physical Layout pane, not just from the electrical
 * Schematic pane). Kept in one place so the two panes can never drift on
 * label text.
 */
export const SHIELD_TYPES: { value: ShieldType; label: string }[] = [
  { value: 'braid', label: 'Braid' },
  { value: 'foil', label: 'Foil' },
  { value: 'foilBraid', label: 'Foil + braid' },
  { value: 'served', label: 'Served (spiral)' },
];

export const SHIELD_TERMINATION_STYLES: { value: NonNullable<ShieldTermination['style']>; label: string }[] = [
  { value: 'pigtail', label: 'Pigtail' },
  { value: 'lugTo360', label: 'Lug to 360° backshell' },
  { value: 'drainWire', label: 'Drain wire' },
  { value: 'none', label: 'None' },
];

/** How the shield is documented and costed — see ShieldModel in
 * core/types.ts for what each choice means for the BOM. */
export const SHIELD_MODELS: { value: ShieldModel; label: string }[] = [
  { value: 'standalonePart', label: 'Standalone part' },
  { value: 'ipc620WireTermination', label: 'IPC-620 wire + termination' },
  { value: 'custom', label: 'Custom' },
];
