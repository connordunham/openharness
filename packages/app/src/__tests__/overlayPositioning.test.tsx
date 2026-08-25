/**
 * Overlay positioning tests at zoom (T04 / C10).
 *
 * Proves that on-canvas overlays (BundleInspector, CavityStepper,
 * LayoutComponentCard) position their HTML elements using
 * canvasToScreen / layoutComponentCardPosition so they track their canvas
 * anchors correctly at any scale and pan offset.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createEmptyDocument, HarnessStore, type Connector, type HarnessDocument,
} from '@openharness/core';
import type { SceneNode } from '@openharness/render';
import { BundleInspector, LayoutComponentCard } from '../LayoutCanvas.js';
import { SchematicCanvas, CavityStepper } from '../SchematicCanvas.js';

describe('Overlay positioning at zoom', () => {
  describe('BundleInspector positioning', () => {
    const bundle = { id: 'b1', refdes: 'BND1' };
    const noop = () => undefined;

    it('positions at scene.labelPosition transformed by scale and pan', () => {
      const scene = {
        id: 'b1', refdes: 'BND1', color: '#888',
        wireCount: 2, wireIds: ['w1', 'w2'], wireRefdes: ['W1', 'W2'],
        gaugeLabel: '0.5 mm²', diameterMm: 3.0, outlineWidthPx: 12,
        polyline: [], labelPosition: { x: 200, y: 150 }, labelText: 'BND1',
        crossings: [], hasCrossing: false,
      };

      // Scale 1, Pan 0: left: 200px, top: 150 + 14 = 164px
      const html100 = renderToStaticMarkup(createElement(BundleInspector, {
        bundle, scene, wires: [], canExtractWire: () => true,
        onSetLength: noop, onSetSegmentLength: noop, onSetColor: noop,
        onSetLabel: noop, onExtractWire: noop, onDelete: noop,
        onClearRoutingNodes: noop, onClose: noop,
        scale: 1, panX: 0, panY: 0,
      }));
      expect(html100).toContain('left:200px');
      expect(html100).toContain('top:164px');

      // Scale 2 (200%), Pan (50, 30): left: 200*2 + 50 = 450px, top: 150*2 + 30 + 14 = 344px
      const html200 = renderToStaticMarkup(createElement(BundleInspector, {
        bundle, scene, wires: [], canExtractWire: () => true,
        onSetLength: noop, onSetSegmentLength: noop, onSetColor: noop,
        onSetLabel: noop, onExtractWire: noop, onDelete: noop,
        onClearRoutingNodes: noop, onClose: noop,
        scale: 2, panX: 50, panY: 30,
      }));
      expect(html200).toContain('left:450px');
      expect(html200).toContain('top:344px');

      // Scale 0.5 (50%), Pan (0, 0): left: 200*0.5 = 100px, top: 150*0.5 + 14 = 89px
      const html50 = renderToStaticMarkup(createElement(BundleInspector, {
        bundle, scene, wires: [], canExtractWire: () => true,
        onSetLength: noop, onSetSegmentLength: noop, onSetColor: noop,
        onSetLabel: noop, onExtractWire: noop, onDelete: noop,
        onClearRoutingNodes: noop, onClose: noop,
        scale: 0.5, panX: 0, panY: 0,
      }));
      expect(html50).toContain('left:100px');
      expect(html50).toContain('top:89px');
    });

    it('falls back to default (20, 20) when scene is absent', () => {
      const html = renderToStaticMarkup(createElement(BundleInspector, {
        bundle, wires: [], canExtractWire: () => true,
        onSetLength: noop, onSetSegmentLength: noop, onSetColor: noop,
        onSetLabel: noop, onExtractWire: noop, onDelete: noop,
        onClearRoutingNodes: noop, onClose: noop,
        scale: 1, panX: 0, panY: 0,
      }));
      // Fallback anchor is (20, 20), with unconditional +14 margin => top: 34px
      expect(html).toContain('left:20px');
      expect(html).toContain('top:34px');
    });

    it('falls back to default (20, 20) transformed by scale and pan', () => {
      const html = renderToStaticMarkup(createElement(BundleInspector, {
        bundle, wires: [], canExtractWire: () => true,
        onSetLength: noop, onSetSegmentLength: noop, onSetColor: noop,
        onSetLabel: noop, onExtractWire: noop, onDelete: noop,
        onClearRoutingNodes: noop, onClose: noop,
        scale: 2, panX: 10, panY: 15,
      }));
      // left: 20 * 2 + 10 = 50px, top: 20 * 2 + 15 + 14 = 69px
      expect(html).toContain('left:50px');
      expect(html).toContain('top:69px');
    });
  });

  describe('SchematicCanvas component overlay positioning', () => {
    function schematicDoc(): HarnessDocument {
      const d = createEmptyDocument('Test');
      d.components['c1'] = {
        id: 'c1', type: 'connector', refdes: 'J1',
        cavities: [
          { id: 'cv1', designation: '1', custom: {} },
          { id: 'cv2', designation: '2', custom: {} },
        ],
        schematicPosition: { x: 100, y: 100 },
        custom: {},
      } satisfies Connector;
      return d;
    }

    it('renders schematic canvas without crashing when components exist', () => {
      const store = new HarnessStore(schematicDoc());
      const html = renderToStaticMarkup(createElement(SchematicCanvas, { store }));
      expect(html).toContain('J1');
    });

    it('CavityStepper positions via canvasToScreen across multiple zoom and pan values', () => {
      const doc = createEmptyDocument('Test');
      const connector: Connector = {
        id: 'c1',
        type: 'connector',
        refdes: 'J1',
        cavities: [
          { id: 'cv1', designation: '1', custom: {} },
          { id: 'cv2', designation: '2', custom: {} },
        ],
        schematicPosition: { x: 100, y: 200 },
        custom: {},
      };
      doc.components['c1'] = connector;
      const store = new HarnessStore(doc);
      const node: SceneNode = {
        componentId: 'c1',
        type: 'connector',
        refdes: 'J1',
        x: 100,
        y: 200,
        width: 50,
        height: 30,
        rows: [],
      };

      // 1. Scale 1, Pan (0, 0): left: 100px, top: 200 - 38 = 162px
      const html1 = renderToStaticMarkup(createElement(CavityStepper, {
        store, connector, node, scale: 1, panX: 0, panY: 0,
      }));
      expect(html1).toContain('left:100px');
      expect(html1).toContain('top:162px');

      // 2. Scale 2, Pan (10, 20): left: 100*2 + 10 = 210px, top: 200*2 + 20 - 38 = 382px
      const html2 = renderToStaticMarkup(createElement(CavityStepper, {
        store, connector, node, scale: 2, panX: 10, panY: 20,
      }));
      expect(html2).toContain('left:210px');
      expect(html2).toContain('top:382px');

      // 3. Scale 0.5, Pan (30, 40): left: 100*0.5 + 30 = 80px, top: 200*0.5 + 40 - 38 = 102px
      const html05 = renderToStaticMarkup(createElement(CavityStepper, {
        store, connector, node, scale: 0.5, panX: 30, panY: 40,
      }));
      expect(html05).toContain('left:80px');
      expect(html05).toContain('top:102px');

      // 4. Scale 4, Pan (-50, -30): left: 100*4 - 50 = 350px, top: 200*4 - 30 - 38 = 732px
      const html4 = renderToStaticMarkup(createElement(CavityStepper, {
        store, connector, node, scale: 4, panX: -50, panY: -30,
      }));
      expect(html4).toContain('left:350px');
      expect(html4).toContain('top:732px');
    });
  });

  describe('LayoutCanvas component card positioning', () => {
    function layoutDoc(): HarnessDocument {
      const d = createEmptyDocument('Test');
      d.components['c1'] = {
        id: 'c1',
        type: 'connector',
        refdes: 'J1',
        cavities: [
          { id: 'cv1', designation: '1', custom: {} },
        ],
        // layoutPosition in mm. PX_PER_MM = 4 in LayoutCanvas, so (25, 50) mm => (100, 200) px
        layoutPosition: { x: 25, y: 50 },
        custom: {},
      } satisfies Connector;
      return d;
    }

    it('LayoutComponentCard positions via layoutComponentCardPosition with scaled HOVER_R across zoom levels', () => {
      const doc = layoutDoc();
      const connector = doc.components['c1']!;
      const store = new HarnessStore(doc);

      // PX_PER_MM is 4 in LayoutCanvas. (25, 50) mm => (100, 200) px. HOVER_R = 24.
      // 1. Scale 1, Pan (0, 0): screen (100, 200) -> left: 100 - 30 = 70px, top: 200 + 24*1 + 22 = 246px
      const html1 = renderToStaticMarkup(createElement(LayoutComponentCard, {
        component: connector, doc, store, scale: 1, panX: 0, panY: 0,
      }));
      expect(html1).toContain('left:70px');
      expect(html1).toContain('top:246px');

      // 2. Scale 2, Pan (10, 20): screen (100*2 + 10, 200*2 + 20) = (210, 420)
      //    left: 210 - 30 = 180px, top: 420 + 24*2 + 22 = 490px
      const html2 = renderToStaticMarkup(createElement(LayoutComponentCard, {
        component: connector, doc, store, scale: 2, panX: 10, panY: 20,
      }));
      expect(html2).toContain('left:180px');
      expect(html2).toContain('top:490px');

      // 3. Scale 0.5, Pan (30, 40): screen (100*0.5 + 30, 200*0.5 + 40) = (80, 140)
      //    left: 80 - 30 = 50px, top: 140 + 24*0.5 + 22 = 174px
      const html05 = renderToStaticMarkup(createElement(LayoutComponentCard, {
        component: connector, doc, store, scale: 0.5, panX: 30, panY: 40,
      }));
      expect(html05).toContain('left:50px');
      expect(html05).toContain('top:174px');

      // 4. Scale 4, Pan (-50, -30): screen (100*4 - 50, 200*4 - 30) = (350, 770)
      //    left: 350 - 30 = 320px, top: 770 + 24*4 + 22 = 888px
      const html4 = renderToStaticMarkup(createElement(LayoutComponentCard, {
        component: connector, doc, store, scale: 4, panX: -50, panY: -30,
      }));
      expect(html4).toContain('left:320px');
      expect(html4).toContain('top:888px');
    });
  });
});

