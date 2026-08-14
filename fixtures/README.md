# Fixtures

Golden-file test documents (spec §13). The two real exports captured during
research live in the project folder one level up:

- `_reference_harness_export.json` — a real user document (the reference tool wire
  format v0.8): 9 wires, 2 twisted, 3 connectors, 1 splice, 1 resistor.
- `_kitchen_sink_export.json` — a synthetic document built to exercise entity
  types the first document didn't: cable + shield, covering, terminal, note,
  branch point.

As `@openharness/io`'s the reference tool importer is built (Phase 1), add:

1. `.ohd` versions of both, produced by the importer.
2. `expected/{bom.csv,nets.json,diagnostics.json}` for each, once
   `@openharness/core`'s derive algorithms exist to produce them.
3. The two topologies review R1 and R12 call out as still missing evidence:
   a diode, a splice with two wires, a bundle with an authored length, and
   the two-chained-unplaced-splices case for testing `layoutHost` (spec
   §6.2, review R12).

Round-trip (import → export → import) must be a fixed point for every fixture
here — that's the CI-enforced part of spec §11.
