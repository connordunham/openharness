# T20 — Scrap/waste buffer and spool quantity

**Size** M · **Package** `core` · **Needs** T16 · **Spec** `docs/DATA-LAYER-SPEC.md`

## Goal

Turn cut lengths into a purchasing quantity: apply a scrap/waste buffer, sum
per wire part number, and derive how many spools to buy.

This is the one genuinely computed number in the data-layer spec. It is never
hand-entered.

## Contract

### The buffer

- `DocumentSettings.scrapWasteBufferPct` — project-wide default. Absent
  behaves as 0.
- A per-wire override on `Wire`. **Absent** means "use the project default".
  Explicit `0` means "no buffer on this wire". These are different and must
  stay different — this is the project's `undefined`-is-not-zero rule, and the
  submitted spec calls it out explicitly.

### The order of operations

**Buffer each connection, then sum. Never sum then buffer.**

```
for each wire w using part P:
    pct = w.override ?? doc.scrapWasteBufferPct ?? 0
    buffered(w) = length(w) × (1 + pct/100)

bufferedTotal(P) = Σ buffered(w)
```

The two orders give different answers the moment any wire carries an override,
and only this one is right. A test must pin it.

### Spool quantity

```
spoolsNeeded(P) = ceil( bufferedTotal(P) / spoolLength(P) )
```

Both in µm. `spoolLength` comes from `wire_specs`; if it is unknown, the result
is **unknown**, not 1 and not 0. A missing spool length must not silently
become a purchase quantity.

Ceiling is the default rounding rule pending an engineer ruling — see
`DOMAIN-DECISIONS.md` Still open. Isolate the rounding behind one named
function so changing it later is a one-line change, not a hunt.

### Reporting

`bufferedTotal` and `spoolsNeeded` join the derived model alongside the
existing per-wire lengths. A wire whose length is unknown contributes unknown,
and the total for that part number is unknown — not the sum of the known ones
presented as if complete.

## Acceptance tests

- no buffer anywhere → buffered total equals raw total exactly
- project default 5%, three wires, no overrides → total is 1.05× raw
- one wire overridden to 0, project default 10% → that wire contributes its raw
  length and the others are buffered — this is the test that pins buffer-then-sum
- one wire overridden to 20%, others at project 5% → each buffered at its own
  rate before summing
- override absent vs override 0 produce different totals when the project
  default is non-zero
- 1000 µm buffered 5% against a 500 µm spool → 3 spools, not 2.1
- exactly one spool's worth after buffering → 1, not 2 (no off-by-one at the
  boundary)
- unknown spool length → spools unknown; the number is absent, not 1
- one wire of unknown length in a group → that part's total reads unknown
- a negative buffer percentage is rejected
- rounding lives in one function and a test calls it directly

## Traps

- **`??` not `||`.** An override of `0` is falsy. `w.override || default`
  silently applies the project default to every wire the user explicitly zeroed
  — the exact bug the spec's NULL-vs-0 note exists to prevent.
- Percentages are not fractions. `5` means 5%, not 500%.
- Do not round intermediate lengths. Round once, at the spool count.
- Integer µm can overflow the safe-integer range only at absurd lengths, but
  the multiply by `(1 + pct/100)` reintroduces floats. Round back to integer µm
  deliberately and say which way in a comment.
- Service loops and strip-length allowance are already in the length pipeline.
  Whether the buffer applies to them is an **open question** — do not decide it
  silently. Apply to cut length for now and leave a comment citing the open
  question.
