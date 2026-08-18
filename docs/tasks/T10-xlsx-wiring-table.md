# T10 — XLSX wiring table

**Size** M · **Needs** T09 · **Package** `io`

## Goal

An Excel workbook of the wiring: one sheet listing every connection, then one
sheet per connector giving that connector's pinout.

The per-connector sheets are the valuable half. A full connection list is what
the existing interconnect CSV already gives; what an assembler actually works
from is a single connector's pinout.

## Contract

- Sheet 1 — every connection: wire refdes, from component + cavity + signal,
  to component + cavity + signal, gauge, colour, length, part number.
- One sheet per connector, named for its refdes: a row per cavity, in cavity
  order, showing the cavity designation, signal, the wire landing there and
  where it goes. **Include empty cavities** — an assembler needs to see that
  a position is deliberately unused, and a gap in the numbering does not say
  that.
- Everything comes from `computeInterconnectTable` plus the document. Do not
  re-derive connectivity.

## Acceptance tests

- workbook has 1 + N sheets for N connectors
- a connector sheet lists every cavity including unpopulated ones
- a wire between two connectors appears on both connectors' sheets, with the
  from/to reversed appropriately on each
- lengths respect `LengthStatus`: an unrouted wire shows blank or "no route",
  never 0
- a sheet name that collides or exceeds Excel's 31-character limit is handled
  deterministically rather than throwing

## Traps

- Excel sheet names have real constraints: 31 characters, no `: \ / ? * [ ]`,
  and must be unique. A refdes can violate all of these.
- Zero is not a length. Same rule as everywhere else in this codebase.
