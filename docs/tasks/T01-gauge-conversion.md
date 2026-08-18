# T01 — Gauge conversion

**Size** S · **Blocks** T02, T03 · **Package** `core`

## Goal

One module that converts between every `GaugeUnit`, so nothing else ever
compares two gauges by their raw `.value`.

## Why this is first

Three later packets need to answer "is this wire within this contact's
range?". Without a shared module each invents its own conversion, and the
mm²-vs-AWG direction is inverted (bigger AWG number = smaller conductor), so
they will not merely differ — one of them will be backwards.

## Contract

New file `packages/core/src/gauge.ts`, exported from `core/index.ts`.

```ts
/** Canonical unit. Every comparison and sum happens here. */
export function toSquareMillimetres(g: Gauge): number

/** Round-trip out of canonical form for display. */
export function fromSquareMillimetres(mm2: number, unit: GaugeUnit): number

/** Negative / zero / equal, for range checks. Never compares `.value`. */
export function compareGauge(a: Gauge, b: Gauge): number

/** True when `g` falls inside the range. An absent bound is unconstrained,
 *  NOT zero. An entirely absent range accepts everything. */
export function gaugeWithinRange(g: Gauge, range: GaugeRange): boolean

/** Sum of several conductors sharing one cavity, in `unit`. This is the
 *  operation the overfill rule needs: convert each to mm², add, convert the
 *  total back — never add AWG numbers. */
export function sumGauges(gauges: Gauge[], unit: GaugeUnit): number
```

## The rules

- **Canonical unit is mm².** Everything converts in, compares, converts out.
- **AWG is a lookup table, not a formula.** The geometric formula is close but
  disagrees with published conductor areas at the sizes that matter. Table it
  from a cited standard covering at least 30 AWG to 4/0, and put the citation
  in a comment. Represent 1/0…4/0 as 0, −1, −2, −3 and say so.
- **`cmil` is definitional**: 1 cmil = area of a circle 0.001 in across =
  π/4 × 0.0254² mm² ≈ 5.067e-4 mm². `kcmil` is 1000 cmil. Derive both from
  the definition in code rather than pasting a rounded constant.
- **`fromSquareMillimetres` to AWG returns the nearest tabulated size**, and
  callers must treat it as lossy. Do not invent fractional AWG.

## Acceptance tests

`packages/core/src/__tests__/gauge.test.ts`

- round-trips mm² → each unit → mm² within tolerance
- 18 AWG converts to ≈0.823 mm² (cite your source's value in the test)
- `compareGauge` orders 20 AWG below 18 AWG — the inversion, asserted directly
- 500 kcmil ≈ 253 mm²
- `gaugeWithinRange` accepts anything when both bounds are absent
- `gaugeWithinRange` treats a one-sided range as unbounded in the other
  direction, and specifically does **not** treat the missing bound as 0
- `sumGauges` of three 20 AWG conductors is meaningfully larger than one, and
  is computed in mm² — assert against the mm² sum, not an AWG number

## Traps

- Larger AWG number means smaller conductor. Every comparison reads backwards
  from intuition, which is why `compareGauge` exists rather than `<`.
- Do not round inside `toSquareMillimetres`. Round once, at display.
