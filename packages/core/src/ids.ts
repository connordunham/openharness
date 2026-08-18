import { nanoid } from 'nanoid';

/**
 * Two ID spaces, per HARNESS-DESIGNER-SPEC.md §3.3:
 * instance ids are short (nanoid-ish, ~10 chars), part ids are longer (~21 chars)
 * — mirroring what was observed in real exports from the reference tool.
 */
export type ComponentId = string;
export type WireId = string;
export type BundleId = string;
export type GroupId = string;
export type NoteId = string;
export type PartId = string;
export type CavityId = string;
export type TwistGroupId = string;
export type MateId = string;

export function newInstanceId(): ComponentId {
  return nanoid(10);
}

export function newPartId(): PartId {
  return nanoid(21);
}
