# Task packets

Ordered work, one packet per file. Each is self-contained — read
`docs/HANDOFF.md` once, then only the packet you are doing.

## Order and dependencies

```
T01 gauge conversion ──┬── T02 mates ── T03 wire-gauge-vs-contact DRC
                       └── T03
T04 zoom  (independent, do early — every later canvas task is easier after it)
T05 schematic ergonomics   (independent)
T06 view toggles + selection info   (independent)
T07 search + destinations   (after T06: shares the view-options surface)
T08 groups / frames   (independent)
T09 PDF export ── T10 XLSX wiring table   (T09 first: shares the page model)
T11 parts library   (independent)
T12 formboard   (after T04: needs zoom to be usable at 1:1)
T13 automation surface   (last: the API should stop moving first)
```

`T14` and `T15` are the design-rule checks the project's harness engineer named
as highest-value (`docs/DOMAIN-DECISIONS.md` D4). They sit outside the graph
above because they are independent of it — T14 needs T01, T15 needs nothing.
Both are candidates to pull forward: they are the checks most likely to catch a
defect in a harness someone actually builds.

`T01` is genuinely first. Three later packets need gauge comparison and each
would otherwise invent its own, differently wrong, version.

## Status

| Packet | Title | Size | State |
|---|---|---|---|
| T01 | Gauge conversion | S | not started |
| T02 | Mates | L | model landed, rest not started |
| T03 | Wire-gauge-vs-contact validation | M | not started |
| T04 | Zoom | M | not started |
| T05 | Schematic ergonomics | M | not started |
| T06 | View toggles and selection info | M | not started |
| T07 | Search and destinations | L | not started |
| T08 | Groups and the device convention | M | not started |
| T09 | PDF export | L | not started |
| T10 | XLSX wiring table | M | not started |
| T11 | Local parts library | L | not started |
| T12 | Formboard | XL | not started |
| T13 | Automation surface | L | not started |
| T14 | Current capacity with bundle derating | L | not started |
| T15 | Bend radius | M | not started |

S ≈ half a day, M ≈ a day, L ≈ two to three, XL ≈ a week.

Keep this table current — it is the only place the overall state is written
down.
