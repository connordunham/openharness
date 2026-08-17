# OpenHarness — Session Context & Research Dossier

**Purpose:** everything gathered on 2026-08-13 while reverse-engineering the reference tool,
written down so the spec can be regenerated tomorrow **without re-driving the browser**.

**Status of previous work:** two documents were written and then lost to empty OneDrive
placeholders (`Length: 0`, `Attributes: Archive, ReparsePoint`). The research below is the
irreplaceable part and is now captured verbatim. The lost documents were:

- `HARNESS-DESIGNER-SPEC.md` — 51,876 bytes, 15 sections
- `SPEC-REVIEW-RECOMMENDATIONS.md` — 26 recommendations, severity-tagged

Both are fully regenerable from §§1–8 of this file plus the outlines in §§9–10.

> ⚠️ **Write to `C:\HarnessDesigner_Local\` first, then copy into OneDrive.**
> Direct writes into the OneDrive folder from the agent sandbox produced zero-byte
> reparse points. A mirrored copy of everything lives in `C:\HarnessDesigner_Local\`.

---

## 1. Decisions already made (do not re-ask)

| Question | Answer |
|---|---|
| Target stack | **Web app: React + TypeScript** (Vite, SVG rendering) |
| Spec depth | **Full build spec** — data model, features, UI, algorithms, file formats, exports, automation API, phased plan |
| JSON export permission | Granted and used; file captured |
| Deliverable | A design spec for a **local** clone, with your own automations as the primary goal |

**Open decisions flagged for you (from the review, unresolved):**

1. Variants/options in or out of v1 (structural — see §10 R3)
2. Single-file `.ohd` vs directory format `.ohd/` (git merge — R10)
3. Tauri/Electron-first vs browser-first (File System Access API is Chromium-only — R15)
4. Full-recompute vs memoised derived model (R9)

---

## 2. The reference document (hard evidence)

Source: the live document at `a private document URL`, exported via
**Menu → Export → Harness Data (JSON)**.

**Files:**
- `C:\Users\dunha\Downloads\Untitled Harness.json` — original, 5,561 bytes, **intact**
- `C:\HarnessDesigner_Local\_reference_harness_export.json` — restored copy

**Contents:** `version 0.8`, `lengthUnit "mm"`, 3 connectors, 9 top-level wires,
1 twisted-wire group containing 2 wires (**9 + 2 = 11**, which matches the "11 connections"
count shown in the app's Connections view — a useful cross-check), 1 bundle, 1 splice,
1 resistor, 1 resistor part, 1 connector part.

**Verbatim JSON** (reproduced in full so the schema survives even if both files are lost):

```json
{
  "version": 0.8,
  "lengthUnit": "mm",
  "wires": [
    { "id": "mwFnjo", "color": "Red",
      "source": { "id": "Lznc2V", "handle": "p-IS2b" },
      "target": { "id": "gjuazh", "handle": "nDk1xl" } },
    { "id": "gFmdpt", "color": "Orange",
      "source": { "id": "wuPGQg", "handle": "Right" },
      "target": { "id": "gjuazh", "handle": "1d5PTZ" } },
    { "id": "-rSCOf", "color": "Yellow",
      "source": { "id": "Lznc2V", "handle": "URrwpV" },
      "target": { "id": "gjuazh", "handle": "gGRgXZ" } },
    { "id": "M0ImL7", "color": "Red", "stripeColor": "Orange",
      "source": { "id": "Lznc2V", "handle": "l5ZEde" },
      "target": { "id": "YXRkBA", "handle": "Splice" } },
    { "id": "J9-naJ", "color": "Red",
      "source": { "id": "YXRkBA", "handle": "Splice" },
      "target": { "id": "gjuazh", "handle": "wIoqnZ" } },
    { "id": "X70X3J", "color": "Red",
      "source": { "id": "ZWfYpO", "handle": "xfjGEQ" },
      "target": { "id": "YXRkBA", "handle": "Splice" } },
    { "id": "w5EqnS", "color": "Red",
      "source": { "id": "ZWfYpO", "handle": "xfjGEQ" },
      "target": { "id": "gjuazh", "handle": "94gNqp" } },
    { "id": "3cOGZ-", "color": "Orange",
      "source": { "id": "gjuazh", "handle": "FDNI2T" },
      "target": { "id": "ZWfYpO", "handle": "_blVGl" } },
    { "id": "Z8Vl6H", "color": "Orange",
      "source": { "id": "ZWfYpO", "handle": "_blVGl" },
      "target": { "id": "Lznc2V", "handle": "yXM3Z0" } }
  ],
  "connectors": [
    { "id": "gjuazh", "label": "501646120",
      "cavities": [
        { "id": "nDk1xl" }, { "id": "1d5PTZ" }, { "id": "gGRgXZ" },
        { "id": "wT9LNe" }, { "id": "94gNqp" }, { "id": "FDNI2T" },
        { "id": "h7HYSW" }, { "id": "VsW3Lc" }, { "id": "wIoqnZ" }
      ],
      "layoutPosition": { "x": 180, "y": -120 },
      "schematicPosition": { "x": 60, "y": 0 } },
    { "id": "Lznc2V", "label": "J8", "partId": "tjU7wROfiqJTnS2LJStUw",
      "cavities": [
        { "id": "p-IS2b", "signal": "fg" },
        { "id": "haEYec", "global": true, "signal": "sddsfgshg" },
        { "id": "a-MdBc", "signal": "dhfgsd" },
        { "id": "URrwpV", "signal": "shg" },
        { "id": "yXM3Z0", "signal": "s" },
        { "id": "_WAj51", "signal": "gshhh" },
        { "id": "0Ginhb", "signal": "shdd" },
        { "id": "_7zwJT", "signal": "sdhg" },
        { "id": "l5ZEde" },
        { "id": "kD7jPI", "signal": "shg" },
        { "id": "G83ryV", "signal": "s" },
        { "id": "mqThz0", "signal": "hg" },
        { "id": "hrqCeG", "signal": "sgh" },
        { "id": "S2qysI" }
      ],
      "schematicPosition": { "x": 990, "y": -60 } },
    { "id": "ZWfYpO",
      "cavities": [ { "id": "xfjGEQ" }, { "id": "_blVGl" } ],
      "schematicPosition": { "x": 450, "y": 120 } }
  ],
  "twistedWires": [
    { "id": "aZffdH",
      "wires": [
        { "id": "rf3by_", "color": "Blue",
          "source": { "id": "Lznc2V", "handle": "_WAj51" },
          "target": { "id": "gjuazh", "handle": "h7HYSW" } },
        { "id": "yAO7T4", "color": "Violet",
          "source": { "id": "Lznc2V", "handle": "0Ginhb" },
          "target": { "id": "gjuazh", "handle": "VsW3Lc" } }
      ],
      "schematicPosition": { "x": 990, "y": 180 } }
  ],
  "bundles": [ { "id": "jBSCwN", "sourceId": "gjuazh", "targetId": "Lznc2V" } ],
  "splices": [ { "id": "YXRkBA", "schematicPosition": { "x": 540, "y": 240 } } ],
  "resistors": [
    { "id": "wuPGQg", "partId": "_lvZAR",
      "layoutPosition": { "x": 450, "y": -30 },
      "schematicPosition": { "x": 600, "y": 60 } }
  ],
  "resistorParts": [ { "id": "_lvZAR" } ],
  "connectorParts": [
    { "id": "tjU7wROfiqJTnS2LJStUw",
      "partNumber": "501646120", "manufacturer": "Molex",
      "configurations": [ { "id": "2nvYXGSZPAP-HK8TZpKy2" } ],
      "numberOfCavities": 1 }
  ]
}
```

### 2.1 Schema inferences drawn from it

| Observation | Consequence |
|---|---|
| Instance IDs are 6-char nanoid-ish; part IDs are 21-char nanoid | Two ID spaces: `nanoid(10)` instances, `nanoid(21)` parts |
| Endpoint is `{ id, handle }`; handle is a cavity id **or** a magic string (`"Splice"`, `"Right"`) | Model as a tagged union `Endpoint`, not a bare string |
| Splices use one handle `"Splice"` for all attached wires | Splices are **n-ary hyper-nodes**; net traversal must treat them as one vertex |
| `bundles` carry only `sourceId`/`targetId` — no geometry, no wire list, no length | **Wire→segment routing is derived, not stored.** This is the origin of `NO ROUTE` |
| `twistedWires` nests full wire objects | Flatten on import; keep `twistGroupId` on the wire |
| Only some components have `layoutPosition` | Absent ⇒ schematic-only ⇒ contributes no route |
| Component types live in separate top-level arrays | Normalise to one `components` map with a `type` discriminant |
| Parts are embedded in the doc *and* in a global library | Document embeds a **frozen snapshot**; library is a cache. Keep this. |
| Part says `numberOfCavities: 1` but the instance has 9 cavities | **Instance cavity list is authoritative**; part value is only a default |
| `cavity.global: true` seen on one cavity | Global signals join a net document-wide with no drawn wire |
| Only `"Right"` seen for the resistor handle | `"Left"` is inferred as its counterpart |

---

## 3. Observed UI — complete inventory

### 3.1 Workspace shell

Multi-pane workspace; each pane hosts one of **four view types** via a dropdown in its header:
**Schematic · Layout · Parts · Connections**.
Pane header controls: `[search] [view-type ▾] [split] [close]`.
Selection is **linked across panes**. Status bar bottom-left shows selection
(e.g. `C3`, or `B1 · 5 wires`).

### 3.2 Main menu

```
New harness
Open...
Export ▸  Schematic (PDF) · Layout (PDF) · Wiring table (XLSX) · BOM (CSV) · Harness Data (JSON)
Share
Revisions
Harness settings
──────
Docs ↗ · Discord ↗ · Give feedback
──────
Parts library
Preferences
Account
Upgrade to Pro
```

### 3.3 Schematic — add menu (right-click canvas)

```
Connector
Terminal ▸ Ferrule · Ring · Spade · Male Quick Connect · Female Quick Connect · Loose Wire End
Splice
Cable
Diode
Resistor
Twisted Wires
Note
```

### 3.4 Schematic — connector context menu

```
Assign Part
Add Covering
Add shell
Clear all signals
Width  100% ▸
Rotate
Group
Exclude from BOM
Duplicate
Delete
```

### 3.5 Schematic — cavity (pin row) context menu

```
Do not propagate
Make signal global
Move cavity up
Move cavity down
Add cavity below
Delete cavity
```

Two load-bearing concepts here: **signal propagation** along a net (stoppable per-pin), and
**global signals** (`GND`, `+12V`) that join a net without a drawn wire.

### 3.6 Selected-connector affordances

A `−  N  +` stepper appears above the node to change cavity count live; chevrons on each side
flip which way wires exit. Rest of canvas dims. Status bar shows the refdes (`C3`).

### 3.7 Schematic toolbar (bottom of pane) — all pure view toggles

| Icon | Action | Key |
|---|---|---|
| ⤢ | Fit to view | `F` |
| ∿ | Highlight nets | `N` |
| ⋯ | Dash undefined wire routes | `U` |
| ◎ | Show parts | `P` |
| ▭ | Show coverings | `C` |
| 🏷 | Show destinations | `D` |
| # | Show component IDs | `I` |
| ⓘ | Show warnings | `W` |

### 3.8 Layout view

Add menu (right-click canvas): **Connector · Terminal ▸ (6 kinds) · Branch Point · Note**

The layout is a **graph, not a drawing**. Nodes = connectors/terminals/splices/branch points.
Edges = bundle segments. Observed on selecting a segment:

- status bar shows `B1 · 5 wires`
- the segment **fans open** to render each conductor in its own colour
- an inline length label appears on the segment (`0 mm`) — editability inferred

**Formboard mode** (Harness settings → Formboard): *"Use formboard for layout — This will allow
you to make your layout view 1:1 scale."* This is the manufacturing-drawing mode.

### 3.9 Connections view (wiring table)

Columns, toggleable via the column chooser:
`Conductor ✓ | Part Number | From ✓ | To ✓ | Twisted With | Ident | Group | Net | Length ✓`

Observed rows (11 connections total):

| Conductor | From | To | Length |
|---|---|---|---|
| `W8` Red | `S1` | `501646120.9` | `≥0 mm` |
| `W2` Orange | `R1.B` | `501646120.2` | `≥0 mm` |
| `W11` Red/Orange | `J8.9` | `S1` | `≥0 mm` |
| `W7` Violet | `J8.7 (shdd)` | `501646120.8 (shdd)` | `≥0 mm` |
| `W6` Blue | `J8.6 (gshhh)` | `501646120.7…` | `≥0 mm` |
| `W3` Yellow | `J8.4 (shg)` | `501646120.3 (shg)` | `≥0 mm` |
| `W1` Red | `J8.1 (fg)` | `501646120.1 (fg)` | `≥0 mm` |
| `W10` Orange | `C2.2 (s)` | `J8.5 (s)` | **`NO ROUTE`** |
| `W9` Red | `C2.1` | `S1` | **`NO ROUTE`** |
| `W4` Red | `C2.1` | `501646120.5` | **`NO ROUTE`** |
| `W5` Orange | `501646120.6 (s)` | `C2.2 (s)` | **`NO ROUTE`** |

Notation: `<refdes>.<cavity designation>` with the propagated signal in parentheses.
`Red/Orange` = `color` + `stripeColor`. Refdes prefixes seen: `J`/`C` connectors, `S` splice,
`R` resistor, `W` wire, `B` bundle.

Toolbar: highlight nets · **show only highlighted connections** · column chooser.

### 3.10 Parts library

Global to the account, syncs across projects. Table columns: **Part Number, Manufacturer**.

Part types:
```
Wire · Splice · Diode · Resistor · Cable · Generic Part · Connector
Accessories ▸ Contact · Lock · Dust Cover · Backshell · Boot · Cavity Seal
Terminals   ▸ (same six terminal kinds)
Coverings   ▸ Heat Shrink · Tape · Corrugated Tubing · Spiral Wrap · Tubing · Braided Sleeve
```

**Connector part editor fields (observed directly):**
```
Part Number · Manufacturer · Description · URL · Price
Cavities (count)   [ ] Shell
Designations ▸ template + live preview
Gender · Color
Default Configuration:  Lock · Dust cover · Backshell · Boot · Contact
+ Add configuration
Done                                                    [🗑 delete]
```

**Cavity Designations dialog:** template dropdown = **Numbers · Alphabetical · Grid · Custom**,
with a live Preview field.

A *configuration* = a named bundle of accessory part refs on a connector part (e.g. "sealed" vs
"unsealed"), so the BOM picks up the right seals/locks/backshells automatically.

### 3.11 Settings

**Harness Settings** tabs: `Read-only · Units · Sharing · Formboard`, plus **Delete**.
- Read-only: "Make this harness read-only — This will disable editing the harness."
- Units: Currency (`$ € £ ¥ ₹`), Default length unit (`mm`), Default gauge unit (`mm²`)
- Formboard: "Use formboard for layout — allows 1:1 scale"

**Preferences** tabs: `Appearance · Input · Hotkeys · AI [BETA]`
- Appearance: Color scheme Light/**Dark**/Auto; ☑ *Show wire stripes as dashed lines*;
  ☑ *Only render visible components on the schematic screen* ("may help performance on some devices")
- Input: **not opened** — contents unknown
- AI (beta): see §4

### 3.12 Complete hotkey list (verbatim from Preferences → Hotkeys)

| Action | Key |
|---|---|
| Undo | `Ctrl+Z` |
| Redo | `Ctrl+Shift+Z`, `Ctrl+Y` |
| Fit to view | `F` |
| Focus search | `Space` |
| Clear selection | `Esc` |
| Open parts library | `L` |
| Delete | `Backspace`, `Delete`, `X` |
| Duplicate | `Ctrl+D` |
| Rotate | `R` |
| Make conductors orthogonal | `O` |
| Group | `Ctrl+G` |
| Ungroup | `Ctrl+Shift+G` |
| Toggle destinations | `D` |
| Toggle net highlighting | `N` |
| Toggle part labels | `P` |
| Toggle coverings labels | `C` |
| Toggle dash undefined wire routes | `U` |
| Toggle dash empty bundles | `E` |
| Toggle component IDs | `I` |
| Toggle warnings | `W` |

(20 entries — this is the complete list; the panel did not scroll further.)

---

## 4. Existing automation surface

Preferences → **AI [BETA]**: *"This is an experimental beta feature. Connect an AI assistant to
your the reference tool account and it can read and edit your harnesses and parts library for you.
Changes show up in the editor live."*

Presets: **Claude** (Not connected) · **ChatGPT** (Not connected) · **Other**.

**Other** reveals: *"Any MCP-compatible agent can connect with this server URL (sign in with your
the reference tool account):"* → **`a hosted MCP endpoint`**

This is the right shape and validates the plan — but it is hosted, undocumented, has no plugin
system, no scripting, and no local file. That gap is the entire justification for the project.

---

## 5. The core architectural insight

**`NO ROUTE` is the whole architecture.** Bundles store only `sourceId`/`targetId` — no geometry,
no wire membership, no length in the reference file. Therefore wire routing and length are
**derived** by shortest-path through the layout graph. The `U` hotkey (dash undefined wire routes)
is simply that computation rendered on the schematic. Get this right and schematic ↔ layout stay
coupled for free.

**Routing algorithm:**
```
G = (V,E):  V = components with layoutPosition + branch points;  E = bundles
for each wire w:
  a = layoutHost(w.source); b = layoutHost(w.target)
  a or b undefined      → 'unplaced'
  a === b               → 'internal', segments = []
  w.route valid walk    → use it (frozen route)
  else shortestPath(G,a,b) weighted by bundle.length ?? geometricDistance
        no path         → 'noRoute'
        else            → 'routed'
```
Dijkstra + binary heap. Graphs are tiny (tens–low hundreds of nodes); recompute wholesale.

**Length:**
```
length(w) = Σ bundleLength(s) for s in route(w)
          + serviceLoop.source + serviceLoop.target
          + terminationAllowance(source) + terminationAllowance(target)
bundleLength(s) = s.length ?? (formboard ? geometricDistance(s)/scale : 0)
```
If any segment on the route lacks an authored length and formboard is off, the total is a
**lower bound** — exactly the `≥0 mm` display observed in the app.

**Nets:** union-find over cavities/splices/terminals/free ends. Splices are hyper-nodes.
Two-terminal components (R, D) **separate** nets. All `global: true` cavities sharing a signal
merge into one net document-wide. Signal propagation picks the first non-empty `cavity.signal`
per net, preferring `global`, then lowest refdes/cavity index — deterministic so exports are
stable. `noPropagate` cavities are excluded as both source and recipient.

---

## 6. Deliberate divergences from the reference tool (agreed design)

| the reference tool | OpenHarness | Why |
|---|---|---|
| Per-type top-level arrays | One normalised `components` map + `type` discriminant | Every automation gets shorter |
| Nested twisted-wire objects | Flat wires + `twistGroupId` | Queryable |
| Routes always derived | Derived, with optional frozen `route` | Determinism when paths tie |
| No refdes in file | Explicit stable `refdes` on everything | Diffs and scripts need stable names |
| Hosted revisions | Git + semantic diff | You own the history |
| Hosted MCP, no plugins | Local MCP + automation host + CLI | The entire point |
| No custom fields | `custom` on every entity, **namespaced by automation id** | Automations need a safe place to write |

---

## 7. Package layout (agreed)

```
openharness/
├─ packages/
│  ├─ core/         @openharness/core        model, transactions, derive, validate. NO DOM.
│  ├─ render/       @openharness/render      pure SVG scene builders
│  ├─ io/           @openharness/io          load/save, migrations, PDF/XLSX/CSV
│  ├─ automation/   @openharness/automation  plugin host, rule engine, event bus
│  ├─ cli/          openharness              headless commands
│  ├─ mcp/          @openharness/mcp         MCP server over the core API
│  └─ app/          React editor (Vite + TS)
└─ automations/     your scripts
```

**The one hard rule:** `core` has no DOM dependency. GUI, CLI, MCP, tests and automations all sit
on the same core. *If a feature can only be reached by clicking, it is a bug.*

Stack: TypeScript strict · Vite · React 18 · Zustand + Immer · **SVG** rendering ·
TanStack Table · SheetJS · Vitest + golden files.

---

## 8. Built-in DRC rules (v1 set)

| Rule | Severity |
|---|---|
| `NO_ROUTE` | warning |
| `UNPLACED_COMPONENT` | info |
| `EMPTY_BUNDLE` (the `E` toggle) | warning |
| `OVERFILLED_CAVITY` | error |
| `NET_SIGNAL_CONFLICT` | error |
| `MISSING_PART` | warning |
| `CAVITY_COUNT_MISMATCH` | warning |
| `UNSEALED_CAVITY` | warning |
| `GAUGE_TERMINAL_MISMATCH` | error |
| `BUNDLE_DIAMETER_EXCEEDS_COVERING` | warning |
| `DUPLICATE_REFDES` | error |
| `FLOATING_WIRE` | warning |

Bundle diameter estimate: `D ≈ 1.15 · √(Σ dᵢ²)` — valid only for similar-diameter wires; say so
in the rule message.

---

## 9. Outline of the lost SPEC (regenerate to this shape)

1. How this spec was produced (method + what was actually clicked)
2. Goals / non-goals — G1–G6; non-goals: collaboration, 3D, auto-gauge in core, cloud catalogues
3. Observed feature inventory ← **§3 of this file**
4. Reference data format v0.8 ← **§2 of this file**
5. OpenHarness document model — `.ohd`; `HarnessDocument`, `DocumentMeta`, `DocumentSettings`,
   `Component` union (connector/splice/terminal/branchPoint/resistor/diode/cable/generic),
   `Cavity`, `Wire`, `Endpoint` union, `Bundle`, `Covering`, `Part` union, `ConnectorPart`,
   `DesignationTemplate`, `ConnectorConfiguration`, `WirePart`
6. Architecture ← **§7 of this file**; `HarnessStore` API with `transact`/`undo`/`derived`/`on`
7. Derived model & algorithms ← **§5 of this file** + BOM aggregation + DRC ← §8
8. UI spec — pane shell, schematic, layout, connections, parts (+ a 5th **Diagnostics** pane)
9. Exports — schematic PDF, layout PDF, wiring XLSX, BOM CSV, document JSON, vendor JSON
10. Persistence, undo (Immer patches), revisions via git, crash journal
11. Migration from the reference tool — 8 steps, round-trip must be a fixed point
12. Build plan — 7 phases
13. Testing — unit, golden files, round-trip, render snapshots, automation mocks, E2E
14. Things I could not verify
15. Summary of deliberate divergences ← **§6 of this file**

**§14 "could not verify" list (important — keeps inference honest):**
Preferences → Input tab; Share/Revisions dialogs; `Cable` internals; `Covering.span` shape;
`Grid` designation label format (`A1` vs `1A`); Group/Ungroup semantics; whether bundles can carry
an authored length in v0.8; two-terminal `"Left"` handle; bundle length-label editability.

---

## 10. Outline of the lost REVIEW (26 recommendations)

Severities: BLOCKER / HIGH / MEDIUM / LOW.

**§1 Evidence quality**
- **R1 BLOCKER** — The schema rests on one sparse document. It has **zero** cables, coverings,
  terminals, diodes, notes, groups, branch points, wire parts, accessory parts, multi-config parts,
  or authored bundle lengths — ~half the entity types are inference. **Build a "kitchen sink"
  harness in the reference tool containing one of everything, export it, re-derive the schema.**
  Half a day; the single highest-value next action.
- **R2 HIGH** — Also capture one real 40–80-wire harness for shape coverage (deep branch trees,
  splices inside bundles, shared segments, a connector used twice).

**§2 Missing domain concepts**
- **R3 BLOCKER** — **Variants/options are absent and are structural.** Sketch given:
  `DocumentVariants { options[], configurations[], activeConfigurationId }` + a `condition?: string`
  on every entity; derive per active configuration. Retrofitting ≈ a rewrite. Decide in or out.
- **R4 HIGH** — Shields/drain wires need real modelling (`shield { kind, drainWireId, terminations[] }`);
  rules `SHIELD_MULTI_GROUND`, `SHIELD_UNGROUNDED`.
- **R5 HIGH** — Wire needs per-end termination detail (`ends: { source, target }` with
  `stripLength`, `terminalPartId`, `sealPartId`, `treatment`, `crimpHeight`). Makes
  `GAUGE_TERMINAL_MISMATCH` and the cut-list automation actually implementable.
- **R6 MEDIUM** — Connector keying/coding (`keying?: string`) for the mating checker; splice kinds
  (weld/crimp/solder-sleeve) + `SPLICE_OVERFILLED`.
- **R7 MEDIUM** — `CONDUIT_OVERFILL` (40% fill convention) and `BEND_RADIUS_VIOLATION`.

**§3 Architecture risks**
- **R8 HIGH** — `custom: Record<string,unknown>` is unnamespaced → automation collisions.
  Change to `Record<AutomationId, Record<string,unknown>>` with `ctx.data.get/set/getForeign`.
  It's a file-format change; do it now.
- **R9 HIGH** — "Invalidated by touched-key analysis" is 9 words covering the hardest problem.
  **Don't build it in v1.** Full recompute behind a budget: 500 wires / 60 components / 120 bundles
  → derive ≤ 16 ms, measured in CI.
- **R10 HIGH** — "Git as revisions" has no merge story. Recommend **directory format**
  `harness.ohd/{document.json, components/<id>.json, wires/<id>.json, …}` so adds always merge
  cleanly; zip as `.ohdz` for emailing. Add `openharness doctor` for dangling refs.
- **R11 MEDIUM** — Store lengths as **integer micrometres**, not floats — float drift breaks golden
  files and produces phantom semantic diffs.
- **R12 MEDIUM** — Worker + structured-clone of the whole document per call won't scale. Rules get
  only their declared `reads` slices; mutations are patch-in/patch-out; add `--unsafe-in-process`.
- **R13 MEDIUM** — Splice "transparency" is circular as written. Concrete definition given
  (resolve hosts of *other* attached wires, require unanimity, visited-set to terminate chains,
  emit `SPLICE_UNPLACED`).
- **R14 MEDIUM** — Formboard geometry vs authored length will conflict. Authored wins;
  raise `FORMBOARD_LENGTH_MISMATCH`; provide *Set length from geometry* / *Set geometry from length*.
- **R15 MEDIUM** — File System Access API is Chromium-only → argues for **Tauri/Electron primary**,
  browser as demo. Also collapses the worker-sandbox and MCP-server story into one process.
- **R16 LOW** — Undo coalescing on label alone merges distinct intents; key on
  `(label, primaryTargetId)` and never coalesce across a selection change.

**§4 Sequencing and scope**
- **R17 HIGH** — **Automation core is Phase 6 but it's the point of the project.** Re-cut:
  event bus + command registry + rule registry + in-process loader into **Phase 1**;
  automation host + MCP to **Phase 5**; exports demoted to **Phase 6**.
- **R18 HIGH** — Automations write with no consent story. Add: one undo entry per automation
  transaction (non-negotiable); `{ dryRun: true }` returning patches for preview; scoped write
  permissions (`write:wires`, `write:components`, …); warn on `net` + `write:document`;
  trust file at `~/.openharness/trust.json`.
- **R19 MEDIUM** — Cut v1 scope: defer schema-generated part editors, own SVG→PDF emitter, cables,
  groups/notes, `--semantic` diff, revision UI. Keep Diagnostics pane and formboard.
- **R20 MEDIUM** — PDF is the most under-estimated item. `pdf-lib` has **no** SVG support.
  Prefer `svg-to-pdfkit`/PDFKit, or headless-Chromium print. Prototype in week one of that phase.
- **R21 MEDIUM** — No estimates, no acceptance criteria, no ADRs. Estimates given:
  P1 3–4wk · P2 4–6wk · P3 3–4wk · P4 3–4wk · P5 3–4wk · P6 3–5wk → **~20–27 weeks to v1**, ±50%.
  ADRs needed for: SVG vs Canvas · JSON vs SQLite · file vs directory · derive strategy ·
  Tauri vs browser · variants. (`engineering:architecture` skill is installed for this.)

**§5 Interoperability**
- **R22 HIGH** — **Support WireViz** (the de-facto open harness YAML format) — ~3 days, and it
  brings a corpus of test fixtures plus an independent check that the model isn't over-fitted to
  the reference tool. *Best value-for-effort item in the review.* Also read the **KBL (VDA 4964)**
  entity list as a free sanity check (you'll find variants there — not a coincidence).
- **R23 MEDIUM** — KiCad/CSV netlist import belongs in **core Phase 1**, not as an automation —
  it's how a harness gets started. Leave the opinionated matching/merge to automations.

**§6 Process and quality**
- **R24 MEDIUM** — Missing NFRs: performance targets (1000 wires / 200 components / 400 bundles;
  16 ms frame; <1 s load), precision/rounding policy, corrupt-input behaviour (quarantine + doctor,
  never silently drop), locale (invariant by default in exports), accessibility (keyboard-only
  graph editing; never encode meaning in colour alone), and an explicit "no telemetry" commitment.
- **R25 LOW** — Testing needs numbers (core ≥90%, io ≥85%) plus a **seeded document fuzzer**
  asserting invariants (~200 lines; catches what golden files never will).
- **R26 LOW** — Record provenance: observed as a user for interoperability/parity, nothing
  decompiled or copied, format independently designed, import path exists so users can move their
  own data.

**Recommended next week:** R1 → R3 → R10/R15 → R22 → R17 → start Phase 1.

---

## 11. Tomorrow's starting instructions

1. **Write to `C:\HarnessDesigner_Local\` first**, verify byte counts, *then* copy into the
   OneDrive folder and verify again. Do not trust a direct sandbox write into OneDrive.
2. Regenerate `HARNESS-DESIGNER-SPEC.md` from §9 using §§2–8 as source material.
3. Regenerate `SPEC-REVIEW-RECOMMENDATIONS.md` from §10.
4. Then — ideally before either — do **R1**: build the kitchen-sink harness in the reference tool,
   export it, and fold the results in. The spec will be materially more accurate for it.

**Browser note:** Chrome is not signed in to the reference tool. The logged-in session was in
**Microsoft Edge** (window title `the reference tool and 1 more page - Profile 1 - Microsoft Edge`).
The Claude-in-Chrome extension was not connected; the workaround was Windows-MCP `Snapshot`
(`use_dom: true`) for element labels plus PowerShell `SetCursorPos`/`mouse_event` for precise
canvas clicks, because the `Click` tool's `loc` parameter rejects arrays in this environment.

**Cleanup already done:** the test connector (`C3`) and the test connector part created during
exploration were deleted; the live document was verified back at its original 11 connections.
