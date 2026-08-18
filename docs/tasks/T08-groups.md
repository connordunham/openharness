# T08 — Groups and the device convention

**Size** M · **Package** `app`, small `core`

## Goal

Make `Group` real in the UI, which in turn makes the device convention
expressible.

`Group` already exists in `core/types.ts` with `memberIds` and a `label`, and
has no UI at all.

## The device convention

Worth understanding before building, because it is why groups matter:

**There is no device object, and there should not be one.** A switch, relay,
ECU or fuse box is represented by the connectors that mate with it, grouped,
with a `GenericPart` on the group carrying the part number and price. The
document describes the harness and only the harness — device internals are
somebody else's model.

So a group with a part is how a device enters the BOM. That is the feature.

## Contract

- Select several components → right-click → Create group.
- Add to an existing group; remove a member.
- Drag the group by its heading, moving members together.
- A wire between two members of the same group belongs to that group.
- A group may take a `GenericPart`, which then rolls up to the BOM. Extend
  `Group` with `partId?: PartId` — additive, no version bump.
- Schematic only. A group is a logical grouping; Layout is physical.

## Acceptance tests

- creating a group from three components lists exactly those three
- a wire between two members is reported as part of the group; a wire leaving
  the group is not
- removing a member leaves the rest intact
- deleting a group does **not** delete its members
- a group with a `GenericPart` produces exactly one BOM line
- a group with no part produces no BOM line and no "(unassigned)" row

## Traps

- The last test matters: the shield work has the same shape, and the failure
  mode is emitting a mystery unassigned row for something deliberately
  unpriced. See the `standalonePart` handling in `derive/bom.ts`.
- Nested groups are out of scope. Reject rather than half-support them.
- Group geometry is derived from members — never store a group's position or
  size, or it will disagree with its contents the first time one moves.
