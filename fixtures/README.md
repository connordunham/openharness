# Fixtures

Golden-file test documents (spec §13). The two real exports captured during
research live in the project folder one level up (`_reference_harness_export.json`,
`_kitchen_sink_export.json`) and are also copied into
`packages/io/src/__tests__/fixtures/` where `importVendorJson.test.ts`
actually exercises them — that importer (spec §11) is now implemented and
tested against both, including running the full `@openharness/core` derive
pipeline (net extraction → routing → length → BOM → DRC) end-to-end on the
real reference document without throwing.

The R12 splice-host-resolution case (a chain of two unplaced splices between
two placed connectors) is now covered too, as a hand-built fixture in
`packages/core/src/__tests__/routing.test.ts` rather than something exported
from the live app — it caught a real bug (the wire being routed wasn't
excluded from its own splice's neighbour vote) on the first attempt.

Still not covered by any real export (spec §14, review R1): a diode, a splice
with real wiring (the kitchen-sink document has no splice), a bundle with an
authored length, and multi-configuration connector parts in practice. Adding
these to the live `gpVj` kitchen-sink document and re-exporting is a five-
minute follow-up whenever there's time for another browser pass.

Round-trip (import → export → import) must be a fixed point for every
fixture — that's the CI-enforced part of spec §11. Export (the second half of
the round trip) doesn't exist yet, so this isn't tested yet either; it's the
natural next slice once `.ohd` save exists.
