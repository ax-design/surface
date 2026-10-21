import { expect, test } from 'bun:test';
import { CORE_SCHEMA, Values, shapeSpecFrom } from '../src/schema.js';
import type { PropertyValue } from '@ax-design/typed-om';

// Builds a Values bound to CORE_SCHEMA. Anything left unset reads null, so a per-side property
// without an explicit value follows its general one exactly as a fresh surface does.
function values(overrides: { [name: string]: PropertyValue }): Values {
    const v = new Values(CORE_SCHEMA);
    v.values = CORE_SCHEMA.map((spec) => (spec.name in overrides ? overrides[spec.name] : null));
    return v;
}

test('a per-side auto follows the general value', () => {
    const v = values({
        '--ax-edge-kind': 'cusp',
        '--ax-edge-depth': 20,
        '--ax-corner-shoulder-radius': 9,
        '--ax-edge-top-kind': 'auto',
        '--ax-edge-top-depth': 'auto',
        '--ax-corner-top-left-shoulder-radius': 'auto',
    });
    const spec = shapeSpecFrom(v, 200, 100);
    expect(spec.edges[0].kind).toBe('cusp');
    expect(spec.edges[0].depth).toBe(20);
    expect(spec.corners[0].shoulderRadius).toBe(9);
});

test('an explicit per-side value overrides the general one', () => {
    const v = values({
        '--ax-edge-depth': 20,
        '--ax-edge-top-depth': 10,
        '--ax-corner-shoulder-radius': 9,
        '--ax-corner-top-left-shoulder-radius': 4,
    });
    const spec = shapeSpecFrom(v, 200, 100);
    expect(spec.edges[0].depth).toBe(10);
    expect(spec.corners[0].shoulderRadius).toBe(4);
});

test('a negative depth is a value, not the auto sentinel', () => {
    const v = values({
        '--ax-edge-depth': 20,
        '--ax-edge-top-depth': -6,
    });
    const spec = shapeSpecFrom(v, 200, 100);
    expect(spec.edges[0].depth).toBe(-6);
});

test('a per-side kind of auto uses the general kind', () => {
    const v = values({
        '--ax-edge-kind': 'triangle',
        '--ax-edge-top-kind': 'auto',
    });
    const spec = shapeSpecFrom(v, 200, 200);
    expect(spec.edges[0].kind).toBe('triangle');
});

test('a per-side span of auto resolves the general span against its own side', () => {
    const v = values({
        '--ax-edge-span': { px: 0, percent: 50 },
        '--ax-edge-top-span': 'auto',
        '--ax-edge-left-span': 'auto',
    });
    const spec = shapeSpecFrom(v, 200, 100);
    expect(spec.edges[0].span).toBe(100); // top: 50% of width 200
    expect(spec.edges[3].span).toBe(50); // left: 50% of height 100
});
