/**
 * Generates `examples/tail-lamp-loom.ohd` — the document the app offers under
 * File > Open example, and the one the README screenshots show.
 *
 * This is authored here rather than checked in as hand-written JSON for two
 * reasons. The `.ohd` writer owns key ordering (spec §10, sorted keys for
 * clean git diffs), so round-tripping through `serializeDocument` is the only
 * way to be sure the committed file is byte-identical to what the app would
 * save. And the example has to stay *valid* as the model evolves: running this
 * through the real derive pipeline below means a schema change that would
 * break the example fails here, in CI, rather than silently shipping a
 * document that opens with errors.
 *
 * Design intent for the document itself: small enough to read in one screen,
 * complete enough to exercise every pane. A rear lamp loom is the right shape
 * — a body-side connector fanning out to two lamp connectors through a
 * branch point, which is the canonical harness topology (one trunk, two
 * legs) and therefore the thing a first-time user should see routed.
 *
 *   npm run build:example
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeDocument, parseDocument } from '../packages/io/dist/index.js';
import { computeDerivedModel } from '../packages/core/dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Ids are literal and readable rather than generated: this file is a fixture
 * people will open in a text editor to learn the format, and `wire-stop-lh`
 * teaches it in a way `mwFnjo` does not. Nothing in core requires opaque ids —
 * newInstanceId() is a convenience for the GUI, not a constraint. */
const PART = {
  bodyConn: 'part-conn-dt06-6s',
  lampConn: 'part-conn-dt06-4s',
  wire05: 'part-wire-0-5-gxl',
  wire10: 'part-wire-1-0-gxl',
  contact: 'part-contact-0462-201-16141',
  seal: 'part-seal-114017',
};

/** 0.5 mm² GXL primary wire — the workhorse gauge for lighting circuits.
 *
 * `price` and the per-unit-length parasitics are per the DOCUMENT's lengthUnit
 * (mm here), not per metre: derive/bom.ts reports wire quantity in that unit
 * and multiplies straight through, so a per-metre figure here would overstate
 * the extended price by 1000x. R is catalogue-typical for copper at this
 * section (≈37.1 mΩ/m → 3.71e-5 Ω/mm). */
const wire05 = {
  id: PART.wire05,
  kind: 'wire',
  partNumber: 'GXL-20-BK',
  manufacturer: 'Champlain Cable',
  description: '0.5 mm² (20 AWG) GXL cross-linked primary wire',
  gauge: { value: 0.5, unit: 'mm2' },
  insulation: 'XLPE',
  outerDiameter: 1.8,
  tempRating: { min: -50, max: 125 },
  voltageRating: 60,
  currentRating: 11,
  strandCount: 19,
  price: 0.00024,
  resistancePerLength: 0.0000371,
  capacitancePerLength: 1.0e-10,
  custom: {},
};

const wire10 = {
  ...wire05,
  id: PART.wire10,
  partNumber: 'GXL-16-BK',
  description: '1.0 mm² (16 AWG) GXL cross-linked primary wire',
  gauge: { value: 1.0, unit: 'mm2' },
  outerDiameter: 2.3,
  currentRating: 19,
  price: 0.00038,
  resistancePerLength: 0.0000187,
  custom: {},
};

const doc = {
  formatVersion: 1,
  meta: {
    id: 'example-tail-lamp-loom',
    name: 'Rear Lamp Loom',
    createdAt: '2026-09-05T00:00:00.000Z',
    modifiedAt: '2026-09-05T00:00:00.000Z',
    revision: 1,
    readOnly: false,
    custom: {},
  },
  settings: {
    lengthUnit: 'mm',
    gaugeUnit: 'mm2',
    currency: 'USD',
    formboard: { enabled: false, scale: 1 },
    refdesPrefixes: {},
    showParasitics: false,
  },

  parts: {
    [PART.bodyConn]: {
      id: PART.bodyConn,
      kind: 'connector',
      partNumber: 'DT06-6S',
      manufacturer: 'Deutsch (TE)',
      vendorPartNumber: 'A29100-ND',
      description: 'DT series 6-way plug, socket contacts',
      url: 'https://www.te.com/usa-en/product-DT06-6S.html',
      price: 4.12,
      numberOfCavities: 6,
      designationTemplate: { kind: 'numbers', start: 1 },
      gender: 'female',
      hasShell: true,
      housingShape: 'rectangular',
      configurations: [],
      custom: {},
    },
    [PART.lampConn]: {
      id: PART.lampConn,
      kind: 'connector',
      partNumber: 'DT06-4S',
      manufacturer: 'Deutsch (TE)',
      vendorPartNumber: 'A29099-ND',
      description: 'DT series 4-way plug, socket contacts',
      url: 'https://www.te.com/usa-en/product-DT06-4S.html',
      price: 3.48,
      numberOfCavities: 4,
      designationTemplate: { kind: 'numbers', start: 1 },
      gender: 'female',
      hasShell: true,
      housingShape: 'rectangular',
      configurations: [],
      custom: {},
    },
    [PART.wire05]: wire05,
    [PART.wire10]: wire10,
    [PART.contact]: {
      id: PART.contact,
      kind: 'contact',
      partNumber: '0462-201-16141',
      manufacturer: 'Deutsch (TE)',
      description: 'DT size 16 solid socket contact, 0.5–1.0 mm²',
      price: 0.31,
      custom: {},
    },
    [PART.seal]: {
      id: PART.seal,
      kind: 'seal',
      partNumber: '114017',
      manufacturer: 'Deutsch (TE)',
      description: 'DT cavity plug for unused sockets',
      price: 0.08,
      custom: {},
    },
  },

  components: {
    /* C1 is the body-side connector: the single point where this loom meets
     * the rest of the vehicle. Cavity signals are named the way a real
     * schedule names them, because the Table pane shows these verbatim. */
    'comp-body': {
      id: 'comp-body',
      type: 'connector',
      refdes: 'C1',
      label: 'Body harness',
      partId: PART.bodyConn,
      schematicPosition: { x: 120, y: 140 },
      layoutPosition: { x: 60, y: 150 },
      cavities: [
        { id: 'cav-body-1', contactPartId: PART.contact, designation: '1', signal: 'TAIL_LH', direction: 'out', custom: {} },
        { id: 'cav-body-2', contactPartId: PART.contact, designation: '2', signal: 'TAIL_RH', direction: 'out', custom: {} },
        { id: 'cav-body-3', contactPartId: PART.contact, designation: '3', signal: 'STOP_LH', direction: 'out', custom: {} },
        { id: 'cav-body-4', contactPartId: PART.contact, designation: '4', signal: 'STOP_RH', direction: 'out', custom: {} },
        { id: 'cav-body-5', contactPartId: PART.contact, designation: '5', signal: 'GND', global: true, custom: {} },
        { id: 'cav-body-6', contactPartId: PART.contact, designation: '6', signal: 'GND', global: true, custom: {} },
      ],
      custom: {},
    },
    'comp-lamp-lh': {
      id: 'comp-lamp-lh',
      type: 'connector',
      refdes: 'C2',
      label: 'LH lamp',
      partId: PART.lampConn,
      schematicPosition: { x: 780, y: 40 },
      layoutPosition: { x: 470, y: 60 },
      cavities: [
        { id: 'cav-lh-1', contactPartId: PART.contact, designation: '1', signal: 'TAIL_LH', direction: 'in', custom: {} },
        { id: 'cav-lh-2', contactPartId: PART.contact, designation: '2', signal: 'STOP_LH', direction: 'in', custom: {} },
        { id: 'cav-lh-3', contactPartId: PART.contact, designation: '3', signal: 'GND', global: true, custom: {} },
        { id: 'cav-lh-4', sealPartId: PART.seal, designation: '4', custom: {} },
      ],
      custom: {},
    },
    'comp-lamp-rh': {
      id: 'comp-lamp-rh',
      type: 'connector',
      refdes: 'C3',
      label: 'RH lamp',
      partId: PART.lampConn,
      schematicPosition: { x: 780, y: 320 },
      layoutPosition: { x: 470, y: 250 },
      cavities: [
        { id: 'cav-rh-1', contactPartId: PART.contact, designation: '1', signal: 'TAIL_RH', direction: 'in', custom: {} },
        { id: 'cav-rh-2', contactPartId: PART.contact, designation: '2', signal: 'STOP_RH', direction: 'in', custom: {} },
        { id: 'cav-rh-3', contactPartId: PART.contact, designation: '3', signal: 'GND', global: true, custom: {} },
        { id: 'cav-rh-4', sealPartId: PART.seal, designation: '4', custom: {} },
      ],
      custom: {},
    },
    /* The branch point is layout-only topology (spec §4.2) — it has no
     * schematicPosition and never gets one. It is what makes the trunk/leg
     * split explicit, and what gives the two legs different derived lengths. */
    'comp-branch': {
      id: 'comp-branch',
      type: 'branchPoint',
      refdes: 'BP1',
      layoutPosition: { x: 280, y: 150 },
      custom: {},
    },
  },

  /* One wire per circuit. The two GND wires are 1.0 mm² because they carry
   * the return for both lamps; everything else is 0.5 mm². */
  wires: {
    'wire-tail-lh': {
      id: 'wire-tail-lh', refdes: 'W1', color: 'brown', partId: PART.wire05,
      source: { kind: 'cavity', componentId: 'comp-body', cavityId: 'cav-body-1' },
      target: { kind: 'cavity', componentId: 'comp-lamp-lh', cavityId: 'cav-lh-1' },
      custom: {},
    },
    'wire-tail-rh': {
      id: 'wire-tail-rh', refdes: 'W2', color: 'brown', stripeColor: 'white', partId: PART.wire05,
      source: { kind: 'cavity', componentId: 'comp-body', cavityId: 'cav-body-2' },
      target: { kind: 'cavity', componentId: 'comp-lamp-rh', cavityId: 'cav-rh-1' },
      custom: {},
    },
    'wire-stop-lh': {
      id: 'wire-stop-lh', refdes: 'W3', color: 'red', partId: PART.wire05,
      source: { kind: 'cavity', componentId: 'comp-body', cavityId: 'cav-body-3' },
      target: { kind: 'cavity', componentId: 'comp-lamp-lh', cavityId: 'cav-lh-2' },
      custom: {},
    },
    'wire-stop-rh': {
      id: 'wire-stop-rh', refdes: 'W4', color: 'red', stripeColor: 'white', partId: PART.wire05,
      source: { kind: 'cavity', componentId: 'comp-body', cavityId: 'cav-body-4' },
      target: { kind: 'cavity', componentId: 'comp-lamp-rh', cavityId: 'cav-rh-2' },
      custom: {},
    },
    'wire-gnd-lh': {
      id: 'wire-gnd-lh', refdes: 'W5', color: 'black', partId: PART.wire10,
      source: { kind: 'cavity', componentId: 'comp-body', cavityId: 'cav-body-5' },
      target: { kind: 'cavity', componentId: 'comp-lamp-lh', cavityId: 'cav-lh-3' },
      custom: {},
    },
    'wire-gnd-rh': {
      id: 'wire-gnd-rh', refdes: 'W6', color: 'black', partId: PART.wire10,
      source: { kind: 'cavity', componentId: 'comp-body', cavityId: 'cav-body-6' },
      target: { kind: 'cavity', componentId: 'comp-lamp-rh', cavityId: 'cav-rh-3' },
      custom: {},
    },
  },

  /* Trunk + two legs, each with an authored length so every wire derives an
   * `exact` length rather than a geometric lower bound — the Layout pane's
   * wire-length readout is the payoff and it should read as measured, not
   * estimated, in the document people meet first. */
  bundles: {
    'bnd-trunk': {
      id: 'bnd-trunk', refdes: 'B1', label: 'Trunk',
      sourceId: 'comp-body', targetId: 'comp-branch',
      length: 850,
      custom: {},
    },
    'bnd-leg-lh': {
      id: 'bnd-leg-lh', refdes: 'B2', label: 'LH leg',
      sourceId: 'comp-branch', targetId: 'comp-lamp-lh',
      length: 420,
      waypoints: [{ x: 380, y: 90 }],
      segmentLengths: [230, 190],
      custom: {},
    },
    'bnd-leg-rh': {
      id: 'bnd-leg-rh', refdes: 'B3', label: 'RH leg',
      sourceId: 'comp-branch', targetId: 'comp-lamp-rh',
      length: 460,
      waypoints: [{ x: 380, y: 215 }],
      segmentLengths: [250, 210],
      custom: {},
    },
  },

  groups: {},
  notes: {},
  wireGroups: {},
  mates: {},
};

/* Serialize through the real writer, then read it back and run the full
 * derive pipeline. If the example ever stops being clean this throws here
 * instead of shipping. */
const json = serializeDocument(doc);
const reloaded = parseDocument(json);
const derived = computeDerivedModel(reloaded);

const errors = derived.diagnostics.filter((d) => d.severity === 'error');
if (errors.length > 0) {
  console.error('Example document has DRC errors:');
  for (const e of errors) console.error(`  [${e.severity}] ${e.code}: ${e.message}`);
  process.exit(1);
}

const unrouted = Object.entries(derived.wireLengths).filter(([, l]) => l.status !== 'exact');
if (unrouted.length > 0) {
  console.error('Example document has wires without an exact derived length:');
  for (const [id, l] of unrouted) console.error(`  ${id}: ${l.status}`);
  process.exit(1);
}

mkdirSync(join(root, 'examples'), { recursive: true });
writeFileSync(join(root, 'examples', 'tail-lamp-loom.ohd'), json);

const warnings = derived.diagnostics.filter((d) => d.severity === 'warning').length;
console.log(
  `Wrote examples/tail-lamp-loom.ohd — ` +
    `${Object.keys(doc.components).length} components, ${Object.keys(doc.wires).length} wires, ` +
    `${Object.keys(doc.bundles).length} bundles, 0 errors, ${warnings} warnings`,
);
