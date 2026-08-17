# OpenHarness — Design Specification

**A local, automation-first wire harness CAD tool**

Version 0.2 · 2026-08-14 · Author: Claude (for Connor Dunham)
Reference system studied: the reference tool, two documents:
- `ywzg` — a real user document (9 wires, 2 twisted, 3 connectors, 1 splice, 1 resistor)
- `gpVj` — a synthetic "kitchen sink" document built specifically to exercise entity
  types absent from the first (cable + shield, covering, terminal, note, branch point)

Changes from v0.1: the covering and cable data models are corrected against real exports
(v0.1 invented a `Covering.span` union and an elaborate cable/shield shape that turned out
to be wrong — see §3.3 and the changelog in §16).

---

## 0. How this spec was produced

I drove the live the reference tool editor through a browser across two sessions and:

- walked every menu, submenu, context menu and settings dialog
- created a connector, selected it, edited it, and deleted it
- inspected the Connections (wiring table) view and its column set
- selected a layout bundle segment to observe length/route behaviour
- opened the parts library and created a connector part and a covering part to read
  their field sets
- built a second, purpose-made document containing one of every entity type that was
  missing from the first (cable, shield, covering, terminal, note, branch point) and
  exported it
- exported both documents as **Harness Data (JSON)** and read the real schemas

Everything in §2 (feature inventory) and §3 (data model) is **observed**, not inferred,
unless explicitly marked `[inferred]`. §14 lists what is still unverified even after the
second pass.

The two captured exports are saved next to this spec:
`_reference_harness_export.json` (the real document) and
`_kitchen_sink_export.json` (the synthetic one).

---

## 1. Goals and non-goals

### 1.1 Why build this locally

the reference tool is good, free, and browser-based, but it is a hosted product. The constraint
that matters for this project is that **you cannot put your own code in the loop**. There is
a beta MCP endpoint (`a hosted MCP endpoint`) but no plugin system, no scripting
console, no local file format you own, and no way to run a rule on save.

The local version exists so that a harness document is:

1. **A plain file on disk** you can diff, version in git, and script against.
2. **Programmable at every layer** — a stable core API, an event bus, a headless CLI, and
   an MCP server, all operating on the same document model the GUI uses.
3. **Extensible with your own automations** — DRC rules, part-number lookups, BOM
   enrichment, auto-routing, KiCad/Altium net-list import, label printing, cut-list
   generation.

### 1.2 Goals

| # | Goal |
|---|---|
| G1 | Feature parity with the observed the reference tool editor for schematic + layout + wiring table + parts |
| G2 | A single, documented, versioned JSON document format that round-trips losslessly |
| G3 | A pure-TypeScript **core** with zero UI dependencies, usable from Node and the browser |
| G4 | A first-class automation API: transactions, events, derived queries, and a rule engine |
| G5 | Exports: schematic PDF, layout PDF, wiring table XLSX, BOM CSV, document JSON |
| G6 | Runs fully offline; no account, no server required |

### 1.3 Non-goals (v1)

- Real-time multi-user collaboration (the original has Share/Revisions; we do git instead)
- 3D routing or CAD-model-driven harness lengths
- Automatic wire-gauge sizing from current/voltage-drop (a v2 automation, not core)
- Cloud parts catalogues (Digi-Key/Mouser lookups are automations, not core)
- Variants/configurable harnesses — **flagged as an open decision, not ruled out.** See
  the accompanying review document R3. This is large enough that shipping v1 without it
  and retrofitting later is close to a rewrite; decide deliberately before starting Phase 1.

---

## 2. Observed feature inventory (the reference tool)

This is the ground truth the clone is measured against.

### 2.1 Workspace shell

The app is a **multi-pane workspace**. The window is split into N resizable panes; each
pane independently hosts one of four **view types**, chosen from a dropdown in the pane
header:

| View type | Purpose |
|---|---|
| **Schematic** | Logical connectivity — connectors, cavities, wires, splices, twisted pairs, cables, notes |
| **Layout** | Physical topology — connector positions, bundle segments, branch points, lengths |
| **Parts** | Parts used in this document |
| **Connections** | The wiring table (tabular editing of every conductor) |

Each pane header has: search-in-pane, view-type dropdown, split-pane button, close-pane
button. Selection is **linked across panes** — selecting a bundle in Layout highlights its
wires in Schematic and its rows in Connections.

Bottom-left of the window is a **status bar** showing the current selection (e.g. `C3`,
`C1`, or `B1 · 5 wires`), and near it a live **`Saving...`** indicator that appears briefly
after any edit.

### 2.2 Main menu

```
New harness
Open...
Export            ▸ PDF            (PDF)
                    Wiring table   (XLSX)
                    BOM            (CSV)
                    Harness Data   (JSON)
Share
Revisions
Harness settings
─────
Docs ↗ · Discord ↗ · Give feedback
─────
Parts library
Preferences
Account
Upgrade to Pro
```

Note: on the multi-connector reference document the Export submenu listed **Schematic PDF**
and **Layout PDF** as two separate rows; on the near-empty kitchen-sink document it
collapsed to a single **PDF** row. The export menu is content-sensitive — it appears to omit
a per-view PDF option when a view has nothing worth exporting, or maybe merges into a single
PDF when only one view has content. `[inferred]` mechanism, `[observed]` behaviour.

### 2.3 Schematic view

**Add menu (right-click on canvas):**

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

**Connector context menu:**

```
Assign Part
Add Covering
Add shell
Clear all signals
Width          100% ▸
Rotate
Group
Exclude from BOM
Duplicate
Delete
```

**Cable context menu** (differs from connector — confirmed by direct observation):

```
Assign Part
Add shield
Rotate
Group
Exclude from BOM
Duplicate
Delete
```

Notably a cable has **no "Add Covering"** entry — coverings are added to connectors (and
presumably splices/cables through a different path not yet found); a cable instead gets
**"Add shield"**, which appends a `shield` object directly to the cable (§3.3).

**Cavity (pin row) context menu:**

```
Do not propagate
Make signal global
Move cavity up
Move cavity down
Add cavity below
Delete cavity
```

Two concepts here are load-bearing and easy to miss:

- **Propagate** — a signal name entered on one cavity flows along the net to the cavities
  it connects to. `Do not propagate` stops that at this pin.
- **Global signal** — marks a signal as document-wide (e.g. `GND`, `+12V`). In the export
  this is `cavity.global = true`. Global signals form an implicit net across the whole
  harness without a drawn wire.

**Selected-connector affordances:** a `− N +` stepper above the node adjusts cavity count
live; chevrons on each side flip which way the wires exit.

**Note creation:** right-click → Note drops an inline text field directly on the canvas at
the click position; typing commits the text live (`schematicNotes[].text` in the export,
§3.5). No separate dialog.

**Schematic toolbar** (bottom of pane), all of which are pure view toggles:

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

### 2.4 Layout view

**Add menu (right-click on canvas):**

```
Connector
Terminal ▸ (same six terminal types)
Branch Point
Note
```

The layout is a **graph, not a drawing**. Nodes are connectors / terminals / splices /
branch points; edges are **bundle segments**. Selecting a segment:

- shows its ID and wire count in the status bar (`B1 · 5 wires`)
- fans the segment open to render each contained conductor in its own colour
- shows an inline, editable length label on the segment (`0 mm`)

Terminals render in **both** Schematic and Layout simultaneously when placed (confirmed:
a Ring terminal appeared in both panes at once with the same label). Branch points render
**only in Layout** — confirmed: adding one produced no schematic-side element at all, and
its export entry (`branchPoints[]`) carries only a `layoutPosition`, never a
`schematicPosition`.

**Formboard mode** (Harness settings → Formboard) switches the layout canvas to a **1:1
scale** drawing surface, i.e. a real manufacturing formboard you can print and lay wire on.

### 2.5 Connections view (wiring table)

Columns (toggleable):

```
Conductor ✓ | Part Number | From ✓ | To ✓ | Twisted With | Ident | Group | Net | Length ✓
```

Row anatomy from the real document:

| Conductor | From | To | Length |
|---|---|---|---|
| `W8` Red | `S1` | `501646120.9` | `≥0 mm` |
| `W11` Red/Orange | `J8.9` | `S1` | `≥0 mm` |
| `W7` Violet | `J8.7 (shdd)` | `501646120.8 (shdd)` | `≥0 mm` |
| `W10` Orange | `C2.2 (s)` | `J8.5 (s)` | **`NO ROUTE`** |

From the kitchen-sink document, the Length column carries two more badge types beyond
`≥0 mm` and `NO ROUTE`:

| Badge | Meaning (observed) |
|---|---|
| **`JUMPER`** | A cable core — pre-bundled, needs no route through the layout graph. Shown for `CB1.1`, `CB1.2`. |
| **`SHIELD`** | The cable's shield conductor, listed as a normal row (`CB1.SHIELD`) with its own badge instead of a length. |

This is an important correction to the routing model: **cable cores and shields never
appear as `NO ROUTE`**, because they don't participate in the bundle-routing computation at
all — the cable itself is the physical carrier. Only wires that must be routed through
connectors/splices/terminals via bundles get a length or `NO ROUTE`.

Endpoint notation: `<refdes>.<cavity designation>` with the propagated signal name in
parentheses. `Red/Orange` is `color` + `stripeColor`. Refdes prefixes seen: `J`/`C`
connectors, `S` splice, `R` resistor, `W` wire, `B` bundle, `CB` cable.

Toolbar: highlight nets · show only highlighted connections · column chooser.

### 2.6 Parts library

Global to the account, synced across all documents. Table columns: Part Number,
Manufacturer.

**Part types:**

```
Wire · Splice · Diode · Resistor · Cable · Generic Part · Connector
Accessories ▸ Contact · Lock · Dust Cover · Backshell · Boot · Cavity Seal
Terminals   ▸ (six terminal types)
Coverings   ▸ Heat Shrink · Tape · Corrugated Tubing · Spiral Wrap · Tubing · Braided Sleeve
```

**Connector part editor fields:**

```
Part Number · Manufacturer · Description · URL · Price
Cavities (count)  [ ] Shell
Designations  ▸ template: Numbers | Alphabetical | Grid | Custom   (with live preview)
Gender · Color
Default Configuration: Lock · Dust cover · Backshell · Boot · Contact
+ Add configuration
```

**Covering part editor fields** (Heat Shrink, directly observed):

```
Part Number · Manufacturer · Description · URL
Price ($ per m)
Color
Min Diameter (mm) · Max Diameter (mm)
Fixed Length  [ ]
```

This confirms coverings are priced **per unit length**, sized to a wire/bundle by a
**diameter range** (not a single value — my v0.1 spec had this wrong), and can optionally
be flagged `Fixed Length` for pre-formed items (boots, caps) as distinct from cut-to-length
stock (tubing, sleeve, tape).

A **configuration** (on a connector part) is a named bundle of accessory part references —
so the same housing can be used as "sealed variant" vs "unsealed variant" and the BOM picks
up the right seals, locks and backshells automatically.

### 2.7 Settings

**Harness settings:** Read-only toggle · Units (currency $ € £ ¥ ₹, default length unit,
default gauge unit `mm²`/AWG) · Sharing · Formboard (1:1 layout) · Delete.

**Preferences:** Appearance (Light/Dark/Auto, "show wire stripes as dashed lines",
"only render visible components on the schematic screen") · Input · Hotkeys · **AI (beta)**.

### 2.8 Full hotkey list (as shipped)

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

### 2.9 Automation surface (existing)

Preferences → AI (beta) exposes an **MCP server** at `a hosted MCP endpoint`,
described as: *"Connect an AI assistant to your the reference tool account and it can read and
edit your harnesses and parts library for you. Changes show up in the editor live."*
Presets for Claude and ChatGPT, plus a generic endpoint for any MCP client.

This is the right shape, and the clone should ship the same thing — but pointed at a local
file and backed by a documented API rather than an opaque hosted service.

---

## 3. Reference data format (vendor wire-format v0.8)

Two real exports inform this section. Read both carefully; the local format in §4 is a
strict superset designed so imports from either are lossless.

### 3.1 Document A — the real, connected harness

Abridged; full text preserved in `_reference_harness_export.json`.

```jsonc
{
  "version": 0.8,
  "lengthUnit": "mm",

  "wires": [
    { "id": "mwFnjo", "color": "Red",
      "source": { "id": "Lznc2V", "handle": "p-IS2b" },
      "target": { "id": "gjuazh", "handle": "nDk1xl" } },
    { "id": "M0ImL7", "color": "Red", "stripeColor": "Orange",
      "source": { "id": "Lznc2V", "handle": "l5ZEde" },
      "target": { "id": "YXRkBA", "handle": "Splice" } },
    { "id": "gFmdpt", "color": "Orange",
      "source": { "id": "wuPGQg", "handle": "Right" },   // resistor terminal
      "target": { "id": "gjuazh", "handle": "1d5PTZ" } }
  ],

  "connectors": [
    { "id": "gjuazh", "label": "501646120",
      "cavities": [ { "id": "nDk1xl" }, { "id": "1d5PTZ" }, /* ... */ ],
      "layoutPosition":    { "x": 180, "y": -120 },
      "schematicPosition": { "x": 60,  "y": 0 } },
    { "id": "Lznc2V", "label": "J8", "partId": "tjU7wROfiqJTnS2LJStUw",
      "cavities": [
        { "id": "p-IS2b", "signal": "fg" },
        { "id": "haEYec", "global": true, "signal": "sddsfgshg" },
        { "id": "l5ZEde" }
      ],
      "schematicPosition": { "x": 990, "y": -60 } }
  ],

  "twistedWires": [
    { "id": "aZffdH",
      "wires": [ /* full wire objects, nested */ ],
      "schematicPosition": { "x": 990, "y": 180 } }
  ],

  "bundles":  [ { "id": "jBSCwN", "sourceId": "gjuazh", "targetId": "Lznc2V" } ],
  "splices":  [ { "id": "YXRkBA", "schematicPosition": { "x": 540, "y": 240 } } ],

  "resistors":     [ { "id": "wuPGQg", "partId": "_lvZAR",
                       "layoutPosition": { "x": 450, "y": -30 },
                       "schematicPosition": { "x": 600, "y": 60 } } ],
  "resistorParts": [ { "id": "_lvZAR" } ],

  "connectorParts": [
    { "id": "tjU7wROfiqJTnS2LJStUw",
      "partNumber": "501646120", "manufacturer": "Molex",
      "configurations": [ { "id": "2nvYXGSZPAP-HK8TZpKy2" } ],
      "numberOfCavities": 1 }
  ]
}
```

### 3.2 Document B — the kitchen-sink synthetic document

Full text, unabridged (it's short) — this is the part that corrects v0.1:

```json
{
  "version": 0.8,
  "lengthUnit": "mm",
  "connectors": [
    {
      "id": "vyBqwG",
      "cavities": [ { "id": "lxF0Bp" }, { "id": "N5hqhu" } ],
      "schematicPosition": { "x": 120, "y": 120 },
      "coveringIds": [ "pKkzjEdd7TVUvddJ31uLc" ]
    }
  ],
  "terminals": [
    { "id": "wBS56E", "type": "Ring", "schematicPosition": { "x": 120, "y": 330 } }
  ],
  "cables": [
    {
      "id": "_COBvJ",
      "schematicPosition": { "x": 270, "y": 180 },
      "cores": [
        { "id": "59qHnV", "color": "Red" },
        { "id": "dVYDyM", "color": "Orange" }
      ],
      "shield": { "id": "8U5vCT", "color": "Shield" }
    }
  ],
  "schematicNotes": [
    { "id": "UB6426", "schematicPosition": { "x": 527.5, "y": -46 },
      "text": "Kitchen sink test note" }
  ],
  "branchPoints": [
    { "id": "L6l9tT", "layoutPosition": { "x": 210, "y": 450 } }
  ],
  "coveringParts": [
    { "id": "pKkzjEdd7TVUvddJ31uLc", "type": "HeatShrink", "partNumber": "HS-3-BLK" }
  ]
}
```

### 3.3 What both documents together tell us

| Observation | Consequence for our design |
|---|---|
| IDs are short nanoid-ish strings (`mwFnjo`, 6 chars); part IDs are 21-char nanoids | Two ID spaces. Use `nanoid(10)` for instances, `nanoid(21)` for parts. |
| A wire endpoint is `{ id, handle }` where `handle` is a cavity id, or a magic string (`"Splice"`, `"Right"`) | Model handles as a tagged union, not a bare string. |
| Splices have one handle for all wires — they are **n-ary nodes**, not 2-port | Net traversal must treat splices as hyper-nodes. |
| `bundles` carry only `sourceId`/`targetId`, no geometry and no wire membership | Wire→segment routing is **derived**, not stored. This is why `NO ROUTE` exists. |
| `twistedWires` nests full wire objects rather than referencing them | Flatten on import; keep a `twistGroupId` on the wire. |
| Only some components have `layoutPosition` | A component absent from layout is schematic-only; it contributes no route. |
| Component types are **separate top-level arrays** (`connectors`, `splices`, `resistors`, `terminals`, `cables`, `branchPoints`, `schematicNotes`, …) | Normalise into one `components` map keyed by id with a `type` discriminant. |
| Parts are embedded in the document (`connectorParts`, `resistorParts`, `coveringParts`) *and* live in a global library | Document embeds a **frozen snapshot** of every part it uses. Library is a cache. |
| **`connectors[].coveringIds: PartId[]`** — coverings are a plain array of part references directly on the covered component | **Corrects v0.1.** There is no separate `Covering` entity with a `span` union. A covering is just "this part is wrapped around this component." Spans over a partial bundle length, if they exist at all, are not represented this way — treat as unconfirmed (§14). |
| **Cable uses `cores[]`, not `conductors[]`**, each `{id, color}` | Naming matters for round-trip fidelity to the source format even though our own schema can use whatever field name we like internally. |
| **Cable `shield` is a single object shaped exactly like a core** (`{id, color: "Shield"}`), not an array, and `"Shield"` is a literal placeholder color, not a real one | **Corrects v0.1.** No `drainWireId`, no `terminations[]`, no `kind` enum. The shield is just another connectable handle on the cable, with the magic color string doubling as a type marker. Whatever grounding/multi-ground DRC we want, we build by looking at what's wired to the `Shield` handle — not from dedicated shield fields. |
| `terminals[].type: "Ring"` | Confirms a `type` discriminant using the six terminal kinds, PascalCase in the wire format. |
| `branchPoints[]` entries have **only** `layoutPosition`, never `schematicPosition` | Confirms branch points are layout-only, structurally (not just visually). |
| `schematicNotes[].text` | Notes are simple `{id, schematicPosition, text}` — no rich text, no attachment to a component observed. |
| `coveringParts[].type: "HeatShrink"` | Same per-type top-level-array-of-parts pattern as `connectorParts`/`resistorParts`. |
| Only `numberOfCavities: 1` seen on a connector part vs. 9 cavities on the instance | The instance cavity list is authoritative; the part value is only a default. |

---

## 4. OpenHarness document model

File extension **`.ohd`** (JSON, pretty-printed, stable key order → git-diffable).
Also accept `.json` exports from the reference tool and migrate on open.

### 4.1 Top level

```ts
export interface HarnessDocument {
  formatVersion: 1;                  // our format, not theirs
  meta: DocumentMeta;
  settings: DocumentSettings;

  components: Record<ComponentId, Component>;   // normalised, all types
  wires:      Record<WireId, Wire>;
  bundles:    Record<BundleId, Bundle>;
  groups:     Record<GroupId, Group>;
  notes:      Record<NoteId, Note>;

  parts: Record<PartId, Part>;       // frozen snapshot of every part referenced
}

export interface DocumentMeta {
  id: string;
  name: string;
  createdAt: string;                 // ISO 8601
  modifiedAt: string;
  revision: number;                  // bumped on every committed transaction
  readOnly: boolean;
  /** Free-form. Automations own this namespace; core never touches it. */
  custom: Record<string, unknown>;
}

export interface DocumentSettings {
  lengthUnit: 'mm' | 'cm' | 'm' | 'in' | 'ft';
  gaugeUnit: 'mm2' | 'awg';
  currency: 'USD' | 'EUR' | 'GBP' | 'JPY' | 'INR';
  formboard: { enabled: boolean; scale: number; sheet?: SheetSize };
  refdesPrefixes: Record<ComponentType, string>;   // { connector: 'C', splice: 'S', cable: 'CB', ... }
}
```

Note: §4 no longer has a top-level `coverings` map — see §4.4. This is the direct result
of the kitchen-sink evidence in §3.3.

### 4.2 Components

One discriminated union, one map.

```ts
export type ComponentType =
  | 'connector' | 'splice' | 'terminal' | 'branchPoint'
  | 'resistor'  | 'diode'  | 'cable'    | 'generic';

interface ComponentBase {
  id: ComponentId;
  type: ComponentType;
  /** User-visible reference designator: J8, C2, S1, R1, B1, CB1. Auto-assigned, user-overridable. */
  refdes: string;
  label?: string;                    // display name, defaults to part number or refdes
  partId?: PartId;
  configurationId?: string;          // which named part configuration is in use
  schematicPosition?: Point;
  layoutPosition?: Point;
  rotation?: number;                 // degrees, layout only
  excludeFromBom?: boolean;
  groupId?: GroupId;
  /** Parts applied as a covering: heat shrink, tape, sleeve, boot. Observed directly. */
  coveringIds?: PartId[];
  custom: Record<string, unknown>;   // automation-owned
}

export interface Connector extends ComponentBase {
  type: 'connector';
  cavities: Cavity[];                // ordered; index → display order
  widthPercent?: number;             // schematic render width, observed 100% default
  flipped?: boolean;                 // which side wires exit
  hasShell?: boolean;
}

export interface Cavity {
  id: CavityId;
  designation: string;               // "1", "A", "B3" — from the part's designation template
  signal?: string;
  /** Signal is document-global (GND, +12V). Joins the net without a drawn wire. */
  global?: boolean;
  /** Stop signal-name propagation at this pin. */
  noPropagate?: boolean;
  sealPartId?: PartId;
  contactPartId?: PartId;
  custom: Record<string, unknown>;
}

/** n-ary junction. Every wire attached to a splice is on the same net. */
export interface Splice extends ComponentBase {
  type: 'splice';
  spliceKind?: 'crimp' | 'weld' | 'solderSleeve';   // affects BOM/DRC — see review R6
}

export interface Terminal extends ComponentBase {
  type: 'terminal';
  terminalKind: 'ferrule' | 'ring' | 'spade' | 'maleQuickConnect'
              | 'femaleQuickConnect' | 'looseWireEnd';
}

/** Layout-only node where bundle segments meet. Confirmed structurally layout-only. */
export interface BranchPoint extends ComponentBase {
  type: 'branchPoint';
  schematicPosition?: never;
}

export interface TwoTerminal extends ComponentBase {
  type: 'resistor' | 'diode';
  /** Handles are the literals 'Left' and 'Right' (only 'Right' directly observed). */
  polarity?: 'forward' | 'reverse';   // diodes
}

/**
 * A multi-conductor cable: a pre-bundled set of cores with a shared jacket.
 * Confirmed structure — no separate route/length computation applies to its
 * cores or shield; they show JUMPER / SHIELD badges in the wiring table, never
 * NO ROUTE, because the cable itself is the physical carrier.
 */
export interface Cable extends ComponentBase {
  type: 'cable';
  cores: CableCore[];
  /** A cable may have zero or one shield. Structurally identical to a core. */
  shield?: CableCore;
  shielded?: never;   // removed from v0.1 — shield presence is the signal now
}

export interface CableCore {
  id: CavityId;              // shares the cavity/handle id space so wires can target it
  color: WireColor;
  signal?: string;
  designation?: string;      // e.g. "1", "2"; the shield's designation is implicitly "SHIELD"
}
```

### 4.3 Wires

```ts
export interface Wire {
  id: WireId;
  refdes: string;                    // W1, W2, ...
  source: Endpoint;
  target: Endpoint;

  color: WireColor;                  // 'Red' | 'Black' | ... | `#rrggbb`
  stripeColor?: WireColor;           // renders as Red/Orange

  partId?: PartId;                   // wire spec: gauge, insulation, rating
  gauge?: { value: number; unit: 'mm2' | 'awg' };

  ident?: string;                    // printed marking / laser ident
  group?: string;                    // free-text grouping for the wiring table
  twistGroupId?: TwistGroupId;

  /** Explicit route through the layout graph. If absent, the router derives it (§6.2). */
  route?: BundleId[];
  /** Extra slack added to the computed length, per end. */
  serviceLoop?: { source: number; target: number };
  /** Manual override. When set, computed length is shown but this value is used. */
  lengthOverride?: number;

  /** Per-end termination detail — see review R5. Needed for cut lists and crimp DRC. */
  ends?: { source: WireEnd; target: WireEnd };

  custom: Record<string, unknown>;
}

export interface WireEnd {
  stripLength?: number;
  terminalPartId?: PartId;
  sealPartId?: PartId;
  treatment?: 'crimp' | 'solder' | 'tinned' | 'ultrasonicWeld' | 'none';
  crimpHeight?: number;
}

export type Endpoint =
  | { kind: 'cavity';   componentId: ComponentId; cavityId: CavityId }
  | { kind: 'cableCore'; componentId: ComponentId; coreId: CavityId }   // includes the shield
  | { kind: 'splice';   componentId: ComponentId }
  | { kind: 'terminal'; componentId: ComponentId; side: 'Left' | 'Right' }
  | { kind: 'free';     point: Point };            // unterminated wire end
```

Cable cores and the shield are addressed the same way a connector cavity is (they share the
handle-id space in the source format), which is why `Endpoint` gets its own `cableCore`
variant rather than overloading `cavity`: a cable core is never routed through the bundle
graph the way a cavity's wire is (§6.2 has the exact rule).

### 4.4 Bundles, coverings, and cable core routing

```ts
/** An edge in the layout graph. Geometry is implied by its endpoints' layoutPositions. */
export interface Bundle {
  id: BundleId;
  refdes: string;                    // B1, B2, ...
  sourceId: ComponentId;
  targetId: ComponentId;
  /** Authored length. If undefined, falls back to scaled geometric distance. */
  length?: number;
  /** Optional intermediate waypoints for drawing a curved/dog-leg segment. */
  waypoints?: Point[];
  custom: Record<string, unknown>;
}
```

**Coverings are not a separate top-level entity.** §3.3 confirms the source format attaches
them as `coveringIds: PartId[]` directly on the covered component (observed on a
`Connector`; the connector's "Add Covering" menu item is the only place a covering was
successfully created — the cable's equivalent action is "Add shield", not "Add Covering").
We keep the same shape: `ComponentBase.coveringIds`. This is simpler than v0.1's invented
`Covering.span` union and is **not a divergence** — it's a correction to match the real
format.

What is genuinely unconfirmed is whether a covering can apply to a **partial bundle
length** (e.g. heat shrink over just the last 50mm of a run) rather than a whole component.
No such case was observed. Treat partial-span coverings as an open question — see §14 — and
if you need it, the natural extension is to allow `coveringIds` on `Bundle` as well as on
`ComponentBase`, with an optional `{ startMm, endMm }` pair, rather than resurrecting a
separate entity.

**Cable core/shield routing.** A cable's `cores` and `shield` never participate in the
bundle shortest-path computation (§6.2) — the cable component itself is the physical
carrier between its two schematic-side connections, exactly like a pre-terminated jumper.
The wiring table shows `JUMPER` for cores and `SHIELD` for the shield instead of a computed
length. Model this as a length **status**, not as a special case bolted onto the router:

```ts
export type LengthStatus = 'exact' | 'lowerBound' | 'noRoute' | 'unplaced' | 'overridden'
                          | 'jumper' | 'shield';
```

### 4.5 Parts

```ts
export type Part =
  | ConnectorPart | WirePart | CablePart | SplicePart | TerminalPart
  | ResistorPart  | DiodePart | CoveringPart | AccessoryPart | GenericPart;

interface PartBase {
  id: PartId;
  kind: string;
  partNumber?: string;
  manufacturer?: string;
  description?: string;
  url?: string;
  price?: number;
  /** Where this part came from — lets automations refresh from the source. */
  source?: { provider: string; ref: string; fetchedAt: string };
  custom: Record<string, unknown>;
}

export interface ConnectorPart extends PartBase {
  kind: 'connector';
  numberOfCavities: number;
  designationTemplate: DesignationTemplate;
  gender?: 'male' | 'female' | 'hermaphroditic';
  color?: string;
  hasShell?: boolean;
  configurations: ConnectorConfiguration[];
  /** Optional cavity geometry for a to-scale connector face drawing. */
  cavityLayout?: { rows: number; cols: number; pitch: number; map?: (string | null)[][] };
  matingPartId?: PartId;
  /** Keying/coding (Molex A/B/C, Deutsch colour codes). Needed for a real mating check. */
  keying?: string;
}

export type DesignationTemplate =
  | { kind: 'numbers'; start?: number }
  | { kind: 'alphabetical'; skipIOQ?: boolean }
  | { kind: 'grid'; rows: number; cols: number; rowLabels: 'alpha' | 'numeric' }
  | { kind: 'custom'; designations: string[] };

export interface ConnectorConfiguration {
  id: string;
  name: string;                      // "Default", "Sealed", "Panel mount"
  lockPartId?: PartId;
  dustCoverPartId?: PartId;
  backshellPartId?: PartId;
  bootPartId?: PartId;
  contactPartId?: PartId;
  cavitySealPartId?: PartId;
}

export interface WirePart extends PartBase {
  kind: 'wire';
  gauge: { value: number; unit: 'mm2' | 'awg' };
  color?: WireColor;
  stripeColor?: WireColor;
  insulation?: string;               // 'PVC' | 'XLPE' | 'PTFE' | free text
  outerDiameter?: number;            // mm — needed for bundle-diameter DRC
  tempRating?: { min: number; max: number };
  voltageRating?: number;
  currentRating?: number;            // A — needed for the ampacity rule
  strandCount?: number;
}

/**
 * Confirmed directly against the live "Heat Shrink" part editor:
 * Part Number · Manufacturer · Description · URL · Price ($/m) · Color ·
 * Min Diameter · Max Diameter · Fixed Length checkbox.
 */
export interface CoveringPart extends PartBase {
  kind: 'covering';
  coveringType: 'heatShrink' | 'tape' | 'corrugatedTubing' | 'spiralWrap'
              | 'tubing' | 'braidedSleeve';
  color?: string;
  minDiameter?: number;              // mm
  maxDiameter?: number;              // mm
  /** True for pre-formed fixed-size items (caps, boots); false/absent for cut-to-length stock. */
  fixedLength?: boolean;
  pricePerMeter?: number;            // distinct from PartBase.price, which is per-unit
}
```

The other part kinds (`SplicePart`, `TerminalPart`, `ResistorPart`, `DiodePart`,
`AccessoryPart`, `GenericPart`) were not opened in this pass; their shapes in this spec
remain `[inferred]` from the parts-library type list and general pattern-matching against
`ConnectorPart`/`CoveringPart`. Flagged in §14.

---

## 5. Architecture

### 5.1 Package layout

```
openharness/
├─ packages/
│  ├─ core/          @openharness/core     — model, transactions, derive, validate. No DOM.
│  ├─ render/        @openharness/render   — pure SVG scene builders (schematic, layout)
│  ├─ io/            @openharness/io       — load/save, migrations, PDF/XLSX/CSV export
│  ├─ automation/    @openharness/automation — plugin host, rule engine, event bus
│  ├─ cli/           openharness           — headless commands
│  ├─ mcp/           @openharness/mcp      — MCP server over the core API
│  └─ app/           the React editor (Vite + TS)
└─ automations/      your scripts live here
```

**Why `core` has no DOM dependency:** it is the single hard rule of this design. Everything
— GUI, CLI, MCP, tests, your automations — sits on the same core. If a feature can only be
reached by clicking, it is a bug.

### 5.2 Stack

| Concern | Choice | Reasoning |
|---|---|---|
| Language | TypeScript, strict | The domain is all invariants; the type system pays for itself here |
| Build | Vite | Fast, boring |
| UI | React 18 | Requested |
| State | Zustand + Immer | Small store, structural sharing, trivially serialisable for undo |
| Rendering | **SVG** for schematic, **SVG + optional Canvas overlay** for layout | Text and hit-testing matter more than raw fill rate at harness scale (hundreds, not millions, of nodes). Keeps PDF export nearly free. |
| Geometry | Custom, small | No general CAD kernel needed |
| Tables | TanStack Table | Connections + Parts views |
| PDF | `svg-to-pdfkit` over `pdf-lib`'s raw path API (see review R20) | `pdf-lib` alone has no SVG support; text/font handling is the expensive part |
| XLSX | SheetJS | |
| Persistence | File System Access API in browser; `fs` in Electron/Tauri/Node | Reconsider browser-primary given the API's Chromium-only reach — see review R15 |
| Tests | Vitest + a golden-file harness (§13) | |

### 5.3 The core API

```ts
export class HarnessStore {
  readonly doc: Readonly<HarnessDocument>;

  /** Every mutation goes through here. Atomic, undoable, emits one event batch. */
  transact<T>(label: string, fn: (draft: HarnessDocument) => T): TransactionResult<T>;

  undo(): void;
  redo(): void;

  /** Memoised derived model. See review R9 — v1 recomputes fully rather than tracking touched keys. */
  readonly derived: DerivedModel;

  on<E extends keyof HarnessEvents>(event: E, handler: HarnessEvents[E]): Unsubscribe;
}

export interface DerivedModel {
  nets: Net[];                                   // §6.1
  wireRoutes: Map<WireId, RouteResult>;          // §6.2
  wireLengths: Map<WireId, LengthResult>;        // §6.3
  bundleContents: Map<BundleId, WireId[]>;
  bundleDiameters: Map<BundleId, number>;
  bom: BomLine[];                                // §6.4
  diagnostics: Diagnostic[];                     // §6.5
}
```

Everything expensive is a **selector over the document**, not stored state. There is
exactly one source of truth, which is what makes automations safe: a script mutates `wires`
and the BOM, lengths, warnings and both canvases update with no further work.

---

## 6. Derived model and algorithms

### 6.1 Net extraction

A **net** is a connected component of the electrical graph.

```
Vertices: every cavity, every splice, every terminal side, every cable core/shield,
          every free end.
Edges:    every wire (source ↔ target).
          Splice: all its attached wires share one vertex (hyper-node).
          Two-terminal components (R, D): NOT an edge — they separate nets.
          Cable cores/shield: independent vertices, connected to the rest of the net
          graph only by wires terminating on them, same as a cavity.
Global:   all cavities with `global: true` and the same `signal` are merged
          into one net across the whole document.
```

Union-Find over the vertex set. O(α(n)) per union, effectively linear.

**Signal propagation.** Once nets are known, each net's signal name is the first non-empty
`cavity.signal` in the net, chosen by (1) any `global` cavity, else (2) lowest component
refdes, then lowest cavity index — deterministic so exports are stable. Cavities with
`noPropagate: true` are excluded both as sources and as recipients. Conflicting explicit
names on the same net raise `NET_SIGNAL_CONFLICT`.

### 6.2 Wire routing through the layout

This is the mechanism behind `NO ROUTE` and the `U` toggle.

```
Layout graph  G = (V, E)
  V = components with a layoutPosition, plus branch points
  E = bundles

For each wire w:
  if endpoint kind is 'cableCore'   → status = 'jumper' (core) or 'shield' (shield); no routing
  a = layoutHost(w.source)     // the component that physically carries this end
  b = layoutHost(w.target)
  if a is undefined or b is undefined      → status = 'unplaced'
  else if a === b                          → status = 'internal', segments = []
  else:
    if w.route is set and is a valid a→b walk in G   → use it (frozen route)
    else:
      P = shortestPath(G, a, b) weighted by bundle.length ?? geometricDistance
      if no path                            → status = 'noRoute'
      else                                  → status = 'routed', segments = P
```

`layoutHost` walks up: a cavity's host is its connector; a splice's host is itself; a
terminal's is itself; a cable core/shield's host is the cable itself, but as established
above, cable cores/shields short-circuit routing entirely rather than reaching this step —
included here for completeness of the fallback path if that assumption turns out wrong for
some case not yet observed (§14).

A splice with no `layoutPosition` is *transparent*: define its host concretely (this closes
a circularity present in v0.1) as —

```
layoutHost(splice S):
  if S.layoutPosition exists            → S
  else:
    H = { layoutHost(other end of w) for w attached to S, excluding the wire being routed }
    if all of H resolve to the same node N   → N
    else                                     → undefined  (status = 'unplaced')
  with a visited-set to terminate on splice-to-splice chains.
```

Emit `SPLICE_UNPLACED` (info) when this resolves to undefined.

Shortest path is Dijkstra with a binary heap. Harness layout graphs are tiny (tens to low
hundreds of nodes) so this is not a bottleneck; recompute the whole map on any layout
change.

**Ambiguity.** When two paths tie within ε, emit `ROUTE_AMBIGUOUS` and pick the
lexicographically smallest bundle-id sequence so results are reproducible. The user or an
automation can then freeze `wire.route`.

### 6.3 Length calculation

```
length(w) = Σ bundleLength(s) for s in route(w)
          + serviceLoop.source + serviceLoop.target
          + terminationAllowance(source) + terminationAllowance(target)
```

- `bundleLength(s) = s.length ?? (formboard.enabled ? geometricDistance(s) / scale : 0)`
- If any segment on the route has no authored length and formboard is off, the total is
  reported as a **lower bound** — this is exactly the `≥0 mm` display in the original.
- `wire.lengthOverride`, if set, wins; the computed value is still surfaced so a DRC rule
  can flag divergence.
- `terminationAllowance` comes from `WireEnd.stripLength` plus a crimp-allowance constant
  from the terminal part, defaulting to 0.
- Cable cores/shield never enter this computation (`jumper`/`shield` status, §4.4).

In formboard mode, authored length and drawn geometry can disagree. Authored `length`
always wins for calculation; when `|authored − geometric| > tolerance`, raise
`FORMBOARD_LENGTH_MISMATCH` (warning) rather than silently picking one.

```ts
export interface LengthResult {
  status: LengthStatus;              // §4.4
  value: number;                     // in document lengthUnit, integer micrometres internally
  segments: { bundleId: BundleId; length: number; authored: boolean }[];
}
```

Store all lengths as **integer micrometres** internally (`1 mm = 1000`), converting only at
UI/export boundaries. Floating-point summation of many segments drifts, and the drift is
order-dependent — which breaks golden-file tests and produces phantom diffs in
`openharness diff --semantic`.

### 6.4 BOM generation

Walk every component, wire, and covering reference; skip anything with `excludeFromBom`.
Group by `partId` (or by a synthetic key for part-less items so they still show as
"unassigned").

| Item source | Qty basis |
|---|---|
| Connector | count |
| Connector configuration accessories (lock, boot, backshell, dust cover) | count × 1 per connector |
| Contacts / cavity seals | count of **populated** cavities (a cavity with no wire needs a seal, not a contact) |
| Wire | total length per wire part, rounded up to the purchasing increment |
| Covering (via `coveringIds`) | total covered length per part, or count if `fixedLength` |
| Cable | count (its cores/shield are not separately purchasable line items) |
| Splice / terminal / resistor / diode | count |

```ts
export interface BomLine {
  partId?: PartId;
  partNumber: string; manufacturer: string; description: string;
  quantity: number; unit: 'ea' | 'mm' | 'm' | 'in' | 'ft';
  unitPrice?: number; extendedPrice?: number;
  refdes: string[];                  // every instance rolled into this line
  warnings: string[];                // 'no part assigned', 'length is a lower bound'
}
```

### 6.5 Validation / DRC

The `W` toggle in the original surfaces warnings; ours is a real rule engine because that is
where your automations will live.

```ts
export interface Rule {
  id: string;
  severity: 'error' | 'warning' | 'info';
  /** Which derived slices this rule reads — used to skip re-running it. */
  reads: (keyof DerivedModel)[];
  run(ctx: RuleContext): Diagnostic[];
}

export interface Diagnostic {
  ruleId: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  targets: { kind: 'component' | 'wire' | 'bundle' | 'cavity' | 'net'; id: string }[];
  /** Optional one-click repair. */
  fix?: { label: string; apply(draft: HarnessDocument): void };
}
```

**Built-in rules (v1):**

| Rule | Severity |
|---|---|
| `NO_ROUTE` — wire has no path through the layout | warning |
| `UNPLACED_COMPONENT` — component missing from layout | info |
| `SPLICE_UNPLACED` — splice host cannot be resolved (§6.2) | info |
| `EMPTY_BUNDLE` — bundle carries zero wires (the `E` toggle) | warning |
| `OVERFILLED_CAVITY` — two wires in one cavity without a splice | error |
| `NET_SIGNAL_CONFLICT` — two different explicit signal names on one net | error |
| `MISSING_PART` — component or wire with no part assigned | warning |
| `CAVITY_COUNT_MISMATCH` — instance cavity count ≠ part `numberOfCavities` | warning |
| `UNSEALED_CAVITY` — sealed connector with an empty, unplugged cavity | warning |
| `GAUGE_TERMINAL_MISMATCH` — wire gauge outside the terminal's `wireRange` | error |
| `BUNDLE_DIAMETER_EXCEEDS_COVERING` — Σ wire ODs outside a covering's min/max diameter | warning |
| `SHIELD_MULTI_GROUND` — a cable's shield handle is wired to ground/chassis at both connections | warning |
| `SHIELD_UNGROUNDED` — a cable's shield handle has no wire at all | warning |
| `DUPLICATE_REFDES` | error |
| `FLOATING_WIRE` — one or both ends unterminated | warning |
| `FORMBOARD_LENGTH_MISMATCH` — authored bundle length disagrees with formboard geometry | warning |

Bundle diameter uses the standard circle-packing approximation
`D ≈ 1.15 · √(Σ dᵢ²)` — good enough for sleeve selection and honest about being an estimate;
say so in the rule message. Note the `BUNDLE_DIAMETER_EXCEEDS_COVERING` rule now checks
against a **range** (`minDiameter`/`maxDiameter`), matching the confirmed `CoveringPart`
fields, not a single `innerDiameter` as v0.1 assumed.

---

## 7. UI specification

### 7.1 Shell

```
┌──────────────────────────────────────────────────────────────────────┐
│ ☰  Untitled Harness              [pane header] [pane header] ...      │
├──────────────────┬──────────────────────┬────────────────────────────┤
│                  │                      │                            │
│    Pane 1        │       Pane 2         │        Pane 3              │
│   (Schematic)    │    (Connections)     │      (Layout)              │
│                  │                      │                            │
│  [view toolbar]  │   [view toolbar]     │    [view toolbar]          │
├──────────────────┴──────────────────────┴────────────────────────────┤
│ C3 · Connector · 2 cavities            [diagnostics: 2 ⚠]  [Saving…] │
└──────────────────────────────────────────────────────────────────────┘
```

Panes are a recursive split tree (`PaneNode = Leaf | Split{dir, ratio, a, b}`), persisted in
the document's UI state sidecar (`.ohd.ui.json`, gitignored) so the layout of the *editor*
never dirties the layout of the *harness*.

Each pane header: `[search] [view-type ▾] [split] [close]`.
Add a fifth view type the original lacks: **Diagnostics** — a filterable list of every
`Diagnostic` with click-to-select and one-click `fix`.

### 7.2 Schematic view

**Node rendering.** A connector is a table: header row (refdes / label / part indicator /
flip chevron) then one row per cavity (`designation | signal`). Wires attach at the row's
outer edge. A cable renders similarly, with one row per core plus a distinguishable row for
the shield (observed conductor colour swatches per row in the reference document's
connector rendering; extend the same idiom to cable cores).

**Wire routing (visual).** Orthogonal-with-fillets by default:

1. Leave both endpoints horizontally by a fixed stub (16 px).
2. Route through a mid-channel x chosen per source-node so wires from the same connector
   fan out without overlapping (channel index = cavity index).
3. Join with quarter-round corners at radius 8.
4. `O` (make conductors orthogonal) snaps a manually-dragged wire back to this scheme.

Twisted pairs render as the interleaved sine crossing seen in the original, drawn between
the two wires' channels over a fixed span centred on the twist group's `schematicPosition`.

**Interactions.**

| Gesture | Result |
|---|---|
| Drag from a cavity's edge handle | Start a wire; drop on another cavity/splice/terminal/cable core to connect |
| Drag onto empty canvas | Creates a free end (flagged `FLOATING_WIRE`) |
| Click cavity signal cell | Inline edit; commits on `Enter`/blur; propagates along the net |
| Right-click canvas / node / cavity | The context menus in §2.3 (connector, cable, and cavity menus differ — confirmed) |
| `−`/`+` stepper on a selected connector | Add/remove trailing cavities (guarded if wired) |
| Marquee drag | Multi-select |
| Scroll / `Ctrl`+scroll | Pan / zoom (0.1×–8×) |
| Right-click → Note | Drops an inline, immediately-editable text field at the click point |

**View toggles** exactly as §2.8, all persisted per-pane.

### 7.3 Layout view

Nodes are drawn as small physical glyphs (connector body, splice dot, ring terminal, branch
point cross). Bundles are thick grey strokes whose width is proportional to
`bundleDiameter`.

- **Selected bundle** fans open into its individual conductors, coloured, with a length
  label.
- **Length label** is directly editable (styling strongly suggests this; not confirmed by
  a successful edit in this pass — see §14); typing a value sets `bundle.length` and
  instantly repropagates every wire length.
- **Cable and terminal placement** — confirmed both render in Layout; terminals also render
  simultaneously in Schematic, branch points do not appear in Schematic at all.
- **Branch points** are draggable; dragging one reshapes the graph geometry but not its
  topology.
- **Formboard mode**: canvas switches to a fixed sheet (A0/A1/ANSI-E, configurable), 1:1
  scale, with a printed ruler border, and `bundle.length` becomes authoritative over screen
  distance.

**Adding topology:** drag from a node's edge to another node to create a bundle. Drop on
empty canvas to create a branch point and a bundle to it in one gesture.

### 7.4 Connections view

Virtualised table over `derived.wireLengths` joined to `wires`. Every cell that maps to a
document field is editable in place, including `From`/`To` (a typeahead over
`refdes.designation`), which means **the wiring table is a full second editor for
connectivity** — often the fastest way to enter a 60-wire harness.

Columns: `Conductor · Part Number · From · To · Twisted With · Ident · Group · Net ·
Length`, plus ours: `Route`, `Status` (surfacing `LengthStatus` including the confirmed
`jumper`/`shield` badges), `Service loop`.

Paste from clipboard: TSV matching the visible columns creates/updates wires in one
transaction.

### 7.5 Parts view / library

Two surfaces over the same data: the **library** (global, `~/.openharness/parts.json` or a
folder of per-part JSON files for git) and the **document's frozen part snapshot**. The
library modal (`L`) is a searchable table; the parts *pane* shows only parts used in this
document with their usage counts and a "sync from library" action that shows a diff before
applying.

Part editors are generated from the part-kind schemas confirmed in §4.5, so adding a field
to `WirePart` adds a field to the form. (Consider deferring the generation framework itself
in v1 and hand-writing the ~8 forms — see review R19 — since only two of them,
`ConnectorPart` and `CoveringPart`, are actually confirmed against the real editor.)

---

## 8. The automation layer

This is the reason the project exists, so it gets a real design rather than an escape
hatch.

### 8.1 Four ways in, one core

```
                      ┌──────────────────────┐
   React editor ─────▶│                      │
   CLI          ─────▶│  @openharness/core   │──▶ derived model ──▶ views/exports
   MCP server   ─────▶│  HarnessStore        │
   Automations  ─────▶│                      │
                      └──────────────────────┘
```

### 8.2 Automation manifest

An automation is a folder in `automations/` with a manifest and an entry module.

```jsonc
// automations/awg-from-current/automation.json
{
  "id": "awg-from-current",
  "name": "Size wire gauge from current",
  "version": "1.0.0",
  "entry": "index.ts",
  "permissions": ["read:document", "write:wires", "net"],
  "contributes": {
    "commands": [
      { "id": "awg.sizeAll", "title": "Size all wires from current", "keybinding": "Ctrl+Alt+G" }
    ],
    "rules":  ["awg.undersized"],
    "panels": [{ "id": "awg.report", "title": "Gauge report" }],
    "exporters": [{ "id": "awg.cutlist", "title": "Cut list (CSV)", "extension": "csv" }]
  }
}
```

Permissions are **scoped**, not a single `write:document` — `write:wires`, `write:components`,
`write:parts`, `write:meta` are independent grants, enforced at the point the host applies
returned patches. A manifest declaring both `net` and any `write:*` scope gets an
install-time warning: that combination is how a supply-chain problem becomes your problem.

### 8.3 The automation API

```ts
export default function activate(ctx: AutomationContext) {

  ctx.commands.register('awg.sizeAll', async () => {
    const currents = await ctx.net.fetchJson('http://localhost:9000/currents');

    // dryRun returns patches without applying them, so a command can show
    // "this will change 47 wires — apply?" before committing.
    const patches = await ctx.store.transact('Size wires from current', draft => {
      for (const wire of Object.values(draft.wires)) {
        const net = ctx.derived.netForWire(wire.id);
        const a = currents[net.signal ?? ''] ?? 0;
        wire.gauge = { value: pickMm2(a), unit: 'mm2' };
      }
    }, { dryRun: true });

    if (await ctx.ui.confirm(`Update ${patches.length} wires?`)) {
      ctx.store.applyPatches(patches, { label: 'Size wires from current' });
    }
  });

  ctx.rules.register({
    id: 'awg.undersized',
    severity: 'error',
    reads: ['nets', 'wireLengths'],
    run: ({ doc, derived }) =>
      Object.values(doc.wires)
        .filter(w => (w.gauge?.value ?? 0) < requiredMm2(w, derived))
        .map(w => ({
          ruleId: 'awg.undersized',
          severity: 'error' as const,
          message: `${w.refdes} is undersized for its net current`,
          targets: [{ kind: 'wire' as const, id: w.id }],
          fix: {
            label: 'Bump to next standard size',
            apply: d => { d.wires[w.id].gauge = nextSize(w.gauge); }
          }
        }))
  });

  // React to changes as they happen
  ctx.on('wire:created', ({ wireId }) => ctx.log.info(`new wire ${wireId}`));
  ctx.on('document:beforeSave', ({ cancel }) => {
    if (ctx.derived.diagnostics.some(d => d.severity === 'error')) {
      cancel('Refusing to save with DRC errors');
    }
  });
}
```

Every automation-originated transaction is **a single undo entry**, labelled with the
automation name — non-negotiable, regardless of how many entities it touches.

### 8.4 Event catalogue

```ts
export interface HarnessEvents {
  'document:opened':      (e: { doc: HarnessDocument }) => void;
  'document:beforeSave':  (e: { doc: HarnessDocument; cancel(reason: string): void }) => void;
  'document:saved':       (e: { path: string }) => void;
  'transaction:committed':(e: { label: string; patches: Patch[]; revision: number }) => void;

  'component:created':    (e: { componentId: ComponentId; type: ComponentType }) => void;
  'component:updated':    (e: { componentId: ComponentId; changed: string[] }) => void;
  'component:deleted':    (e: { componentId: ComponentId }) => void;

  'wire:created' | 'wire:updated' | 'wire:deleted': (e: { wireId: WireId }) => void;
  'bundle:created' | 'bundle:updated' | 'bundle:deleted': (e: { bundleId: BundleId }) => void;

  'derived:invalidated':  (e: { slices: (keyof DerivedModel)[] }) => void;
  'selection:changed':    (e: { selection: SelectionRef[] }) => void;
}
```

### 8.5 Sandboxing

Automations run in a Web Worker (browser) or `node:worker_threads` (desktop/CLI) with a
capability-gated bridge. Rules receive **only the derived slices they declared in `reads`**,
not the whole document; mutations are **patch-in/patch-out** (the automation returns Immer
patches, the host applies them in one transaction on the main thread) rather than a full
structured-clone of the document per call, which does not scale to a rule invoked per
entity on a large document. Keep a `--unsafe-in-process` flag for trusted first-party
automations where the clone cost genuinely doesn't matter.

A minimal trust story: automations from `automations/` are trusted by default; anything
installed from a URL requires explicit per-automation approval recorded in
`~/.openharness/trust.json`.

### 8.6 CLI

```bash
openharness validate  harness.ohd --format json --fail-on error
openharness export    harness.ohd --bom bom.csv --wiring wiring.xlsx \
                                  --schematic sch.pdf --layout lay.pdf
openharness run       harness.ohd --automation awg-from-current --command awg.sizeAll --write
openharness query     harness.ohd --jq '.derived.bom[] | select(.warnings|length>0)'
openharness import    legacy.json --from vendor-json -o harness.ohd
openharness import    board.net --from kicad --merge -o harness.ohd
openharness diff      a.ohd b.ohd --semantic     # nets/BOM diff, not text diff
openharness doctor    harness.ohd                # detect/repair dangling refs after a bad merge
```

`validate` in CI is the payoff: a pull request that changes a harness can fail on a DRC
error. KiCad/CSV netlist import belongs in core (`@openharness/io`), not as an example
automation — it's how a harness typically gets started, and shouldn't wait for the
automation host to exist. The opinionated part — matching board refdes to harness
connectors, merging into an existing document — is exactly the kind of thing to leave to an
automation built on top of the core importer.

### 8.7 MCP server

Mirrors what the reference tool offers, but local and documented.

```
openharness mcp --file harness.ohd [--watch] [--read-only]
```

| Tool | Description |
|---|---|
| `get_document` | Full document, or a filtered slice |
| `list_components` / `get_component` | Query components by type/refdes/part |
| `list_wires` | Wires with derived route, length and status |
| `get_nets` | Nets with signals and member cavities |
| `get_bom` | Current BOM |
| `get_diagnostics` | DRC results |
| `add_connector` / `add_wire` / `add_splice` / `add_bundle` / `add_cable` | Mutations, each one transaction |
| `update_component` / `update_wire` | Patch-style updates |
| `delete` | By id |
| `assign_part` / `search_parts` | Parts library access |
| `set_bundle_length` | The single most useful mutation for length work |
| `export` | Produce any export format to a path |

With `--watch`, the running editor picks up external file changes and reloads — so an agent
and a human can work on the same document at once, mirroring the hosted product's "changes
show up in the editor live."

### 8.8 Ten automations worth writing first

1. **Part-number lookup** — fill `manufacturer`/`description`/`price` from a supplier API on
   `component:updated`.
2. **Ampacity + voltage-drop gauge sizing** — the example in §8.3.
3. **KiCad/Altium netlist merge** — the opinionated matching logic on top of the core
   importer (§8.6).
4. **Cut list generator** — per-wire cut length with `WireEnd.stripLength`/crimp allowances,
   grouped by gauge and colour, straight to a CSV your crimper's software eats. Directly
   enabled by the confirmed `WireEnd` shape in §4.3.
5. **Label/ident sequencer** — assign `ident` values by a house scheme, and emit a
   Brady/Zebra print file.
6. **Colour-code enforcement** — a rule asserting your standard (e.g. GND must be black,
   +12V red).
7. **Connector mating checker** — verify every connector's `matingPartId` **and `keying`**
   are compatible with a paired harness document.
8. **Formboard nesting** — pack the layout onto the smallest standard sheet at 1:1.
9. **Cost roll-up with price breaks** — quantity-tiered pricing across the BOM.
10. **Git pre-commit hook** — `openharness validate --fail-on error` plus a regenerated
    `bom.csv` committed alongside the `.ohd`.

---

## 9. Exports

| Export | Implementation notes |
|---|---|
| **Schematic PDF** | Reuse the SVG scene graph from `@openharness/render`; emit via `svg-to-pdfkit`. Vector, selectable text, one page or tiled. |
| **Layout PDF** | Same path. In formboard mode, emit at true 1:1 with registration marks and a scale bar, tiled across sheets with overlap. |
| **Wiring table XLSX** | One sheet `Connections` (the §7.4 columns), one sheet `Bundles` (id, from, to, length, wire count, diameter), one `Nets`. Frozen header, autofilter. |
| **BOM CSV** | `partNumber, manufacturer, description, quantity, unit, unitPrice, extendedPrice, refdes, warnings`. |
| **Document JSON** | The `.ohd` itself. Stable key order, 2-space indent, sorted record keys → clean git diffs. |
| **WireViz YAML** | See review R22 — small effort, brings an independent fixture corpus and community format alignment. |
| **vendor JSON** | Optional back-export for interop. Lossy for our extensions; warn on what is dropped. |

---

## 10. Persistence, undo, and history

- **Autosave** debounced 800 ms after the last transaction; atomic write (temp + rename).
- **Undo/redo** from Immer patch pairs, not document snapshots — cheap and precise.
  Coalesce same-label transactions inside 400 ms **and** matching primary target so dragging
  is one undo step without merging unrelated edits; never coalesce across a selection
  change.
- **Revisions** — the original has a server-side revision list. Locally: git. A single-file
  `.ohd` will conflict badly on concurrent edits from two branches (id-referencing JSON
  merges are not git's strength); prefer a **directory format**
  (`harness.ohd/{document.json, components/<id>.json, wires/<id>.json, parts/<id>.json}`)
  where adding an entity is a new file and always merges cleanly. Provide
  `openharness doctor` for the cases that still go wrong. Zip as `.ohdz` for the "single
  file to email" case.
- **Crash recovery** — a rolling journal of committed patches in
  `~/.openharness/journal/<docId>.ndjson`; on open, offer to replay anything newer than the
  file.

---

## 11. Migration from the reference tool

`openharness import --from vendor-json` performs:

1. `version: 0.8` recognised; unknown versions warn but attempt anyway.
2. Flatten `connectors`/`splices`/`resistors`/`terminals`/`cables`/`branchPoints`/… into
   `components`, adding `type`.
3. Flatten `twistedWires[].wires` into `wires`, setting `twistGroupId`.
4. Convert endpoints: `{id, handle}` → tagged `Endpoint` by looking `handle` up in the
   target component's cavity/core list; `"Splice"` → `{kind:'splice'}`; `"Left"`/`"Right"`
   → `{kind:'terminal'}`; a handle found in a cable's `cores`/`shield` → `{kind:'cableCore'}`.
5. Synthesise `refdes` values (`C1..`, `S1..`, `W1..`, `B1..`, `CB1..`) matching the
   original's display order so exports stay comparable.
6. Synthesise `designation` per cavity from the part's designation template, or 1-based
   index; the cable shield's designation is synthesised as `"SHIELD"` to match the observed
   `CB1.SHIELD` refdes pattern in the wiring table.
7. Move `coveringIds` on a component straight across — no transformation needed, this is
   now a structural match rather than an inferred one.
8. Move `connectorParts`/`resistorParts`/`coveringParts` into `parts` with a `kind`.
9. Emit an import report listing every field that had no home.

A round-trip test (import → export → import) must be a fixed point. This is a golden test
in CI, run against both `_reference_harness_export.json` and `_kitchen_sink_export.json`.

---

## 12. Build plan

| Phase | Deliverable | Roughly |
|---|---|---|
| **1. Core** | Types, store, transactions, undo, net extraction, **event bus, command registry, rule registry** (moved up — see review R17), KiCad/CSV netlist importer, import from the reference tool, `validate` + `export --bom` CLI. No UI. | 3–4 weeks |
| **2. Schematic editor** | Pane shell, SVG schematic, connectors/cavities/wires/splices/cables/terminals/notes, inline signal editing, context menus (including the confirmed cable-specific menu), hotkeys, save/load | 4–6 weeks |
| **3. Layout + lengths** | Layout graph, bundles, branch points, routing, length propagation, `NO ROUTE`/`JUMPER`/`SHIELD` statuses, the DRC rule set (has a home now — rule registry landed in Phase 1) | 3–4 weeks |
| **4. Tables + parts** | Connections view with in-place editing and paste, parts library, hand-written part editors for the two confirmed shapes plus best-effort forms for the rest, BOM | 3–4 weeks |
| **5. Automation host + MCP** | Worker sandbox, manifest loader, scoped permissions, dry-run/preview, commands/rules/panels/exporters, event bus wiring, CLI `run`, MCP server. **Moved up from last place** — this is the point of the project. | 3–4 weeks |
| **6. Exports** | Schematic/layout PDF (prototype `svg-to-pdfkit` early), XLSX, CSV, formboard 1:1, WireViz | 3–5 weeks |
| **7. Polish** | Diagnostics pane, groups, dark/light theming, performance pass against the 500-wire/16ms budget | open-ended |

**Indicative total: ~20–27 weeks to a complete v1, ±50%.** Phase 1 alone, with the CLI, is
already useful: you can import your existing the reference tool documents and run validation
and BOM generation on them from a script.

Decide before starting Phase 1: variants in/out (§1.3), directory vs. single-file format
(§10), and Tauri/Electron-primary vs. browser-primary (§5.2) — each is cheap to decide now
and expensive to reverse later.

---

## 13. Testing strategy

- **Unit** — net extraction, routing, length propagation, BOM aggregation. Property tests:
  net extraction is invariant under wire reordering; length is invariant under document key
  order.
- **Golden files** — `fixtures/*.ohd` each with a committed `expected/{bom.csv,nets.json,
  diagnostics.json}`. Include both real exports captured in this project as fixtures. Any
  change to derived logic shows up as a reviewable diff.
- **Round-trip** — import(export(import(x))) === import(x), for every fixture.
- **Render** — SVG snapshot tests for the schematic and layout scene builders (string
  compare, no browser needed).
- **Automation** — a mock `AutomationContext` so example automations are unit-testable.
- **E2E** — Playwright over the built app for the handful of gestures that are genuinely
  interaction-dependent (drag-to-wire, marquee, pane splitting).
- **Fuzzer** — a seeded generator of random valid harnesses asserting core invariants
  (derive never throws; every wire has exactly one `LengthStatus`; BOM quantities are
  non-negative; import/export round-trips). ~200 lines, catches what golden files won't.
- **Coverage targets** — `core` ≥ 90% lines, `io` ≥ 85%.

---

## 14. Things I still could not verify

This list shrank from v0.1 but did not close:

- The **Input** tab of Preferences was not opened (pan/zoom/scroll-direction settings
  `[inferred]`).
- **Share** and **Revisions** dialogs were not opened — account features, irrelevant to a
  local build.
- Whether a **covering can apply to a partial bundle length** rather than a whole
  component — no such case was created or observed. §4.4 proposes an extension if needed
  but it is unconfirmed.
- Whether **splices and cables can also receive coverings** — only the connector's "Add
  Covering" menu item was exercised; the cable's equivalent slot is "Add shield" instead.
  Splice menu was not re-checked in this pass for a covering option.
- The `Grid` designation template's exact label format (`A1` vs `1A`) was not sampled.
- `Group`/`Ungroup` semantics are still `[inferred]` from the hotkeys and context menu —
  no group was actually created and inspected in an export.
- Two-terminal `"Left"` handle — still only `"Right"` has been directly observed.
- **Bundle length-label direct editability** — strongly implied by styling, not confirmed
  by successfully typing a new value and observing it change the export.
- The five uninspected part kinds (`SplicePart`, `TerminalPart`, `ResistorPart`,
  `DiodePart`, `AccessoryPart`) — their field shapes in §4.5 are pattern-matched against
  the two confirmed editors (`ConnectorPart`, `CoveringPart`), not observed directly.
- Whether the Export submenu's collapse from two PDF rows to one PDF row (§2.2) reflects a
  real content-sensitivity rule or is coincidental to which document was open — only two
  data points exist.

---

## 15. Summary of deliberate divergences

| the reference tool | OpenHarness | Why |
|---|---|---|
| Per-type top-level arrays | One normalised `components` map with a `type` discriminant | Every automation gets shorter |
| Nested twisted-wire objects | Flat wires + `twistGroupId` | Queryable |
| Routes always derived | Derived, with an optional frozen `route` | Determinism when paths tie |
| No `refdes` in the file | Explicit, stable `refdes` on everything | Diffs and scripts need stable names |
| Hosted revisions | Git + semantic diff, directory format for clean merges | You own the history |
| Hosted MCP, no plugins | Local MCP + automation host + CLI | The entire point |
| No `custom` fields | `custom: Record<string, unknown>` on every entity | Automations need somewhere safe to write |
| Cable core/shield status folded into general routing | Explicit `jumper`/`shield` `LengthStatus` values | Matches the confirmed wiring-table badges precisely instead of overloading `noRoute`/`exact` |

Everything else — `coveringIds` on the component, `cores`/`shield` on the cable, per-type
top-level arrays in the *source* format, the covering part's diameter-range/fixed-length
shape — is **not a divergence**. It's the real format, confirmed.

---

## 16. Changelog from v0.1

- **Covering model rewritten.** v0.1 invented a `Covering.span` discriminated union
  (`bundles` / `partial` / `component`) with no supporting evidence. Real evidence shows
  coverings are simply `coveringIds: PartId[]` on the covered component. The partial-span
  idea is retained only as a flagged, unconfirmed extension point (§4.4, §14).
- **Cable model rewritten.** v0.1's `Cable.shield` was `{ kind, drainWireId, terminations[] }`.
  The real shape is a single object identical to a core: `{ id, color: "Shield" }`. Removed
  the invented fields; shield grounding rules now work by inspecting what's wired to the
  shield handle rather than reading dedicated shield metadata.
- **`CoveringPart` fields corrected** from a guessed `innerDiameter` to the confirmed
  `minDiameter`/`maxDiameter` range, and added the confirmed `fixedLength` flag and
  per-metre pricing.
- **New `LengthStatus` values** `jumper` and `shield`, replacing the assumption that cable
  conductors would follow the same `noRoute`/lower-bound logic as ordinary wires.
- **Terminal/branch-point/note shapes confirmed** as simple, matching the pattern in the
  real export rather than needing invention.
- Folded in the corresponding items from the companion review document (event bus moved to
  Phase 1, directory file format, scoped write permissions, dry-run transactions, fixed-point
  lengths) directly into the relevant sections rather than leaving them as external
  recommendations.

---

*End of specification.*
