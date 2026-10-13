import type { CornerShape, EdgeKind, Quad, ShapeSpec } from '@ax-design/shape';
import type { LengthPercentage, PropertySpec, PropertyValue, Rgba } from '@ax-design/typed-om';

// Core properties every surface reads. Layers add their own (see Layer.schema).
// Names, syntax and initial values are a permanent contract: never change them.

// Array.prototype.flat is ES2019; the package targets ES2017.
function flatten<T>(lists: T[][]): T[] {
    return lists.reduce((all, list) => all.concat(list), [] as T[]);
}

const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
const SIDES = ['top', 'right', 'bottom', 'left'];
const CORNER_SHAPES = ['round', 'bevel', 'scoop', 'notch'];
const EDGE_KINDS = ['flat', 'arc', 'rect', 'triangle', 'trapezoid', 'cusp'];

const lp = (name: string, initial: string): PropertySpec => ({ name, syntax: { type: 'length-percentage' }, initial, inherits: false, register: true });
const len = (name: string, initial: string, inherits = false): PropertySpec => ({ name, syntax: { type: 'length' }, initial, inherits, register: true });
const num = (name: string, initial: string, inherits = false): PropertySpec => ({ name, syntax: { type: 'number' }, initial, inherits, register: true });
const kw = (name: string, values: string[], initial: string, inherits = false): PropertySpec => ({
    name,
    syntax: { type: 'keyword', values },
    initial,
    inherits,
    register: true,
});

const TILT_OFF = { property: '--ax-tilt-mode', values: ['off'] };

const EDGE_PARAMS = ['kind', 'depth', 'span', 'at', 'ratio', 'tip-radius', 'shoulder-radius'];

function edgeSpecs(prefix: string): PropertySpec[] {
    return [
        kw(`${prefix}kind`, EDGE_KINDS, 'flat'),
        len(`${prefix}depth`, '0px'),
        lp(`${prefix}span`, '33%'),
        lp(`${prefix}at`, '50%'),
        num(`${prefix}ratio`, '0.5'),
        len(`${prefix}tip-radius`, '0px'),
        len(`${prefix}shoulder-radius`, '0px'),
    ];
}

// Values for every side or corner at once: --ax-edge-kind, --ax-edge-depth, ...,
// --ax-corner-shoulder-radius. Registered but never read: SHARED_FALLBACK_CSS gives each side's
// or corner's property the shared value unless it sets its own, and the surface reads those.
export const SHARED_SCHEMA: PropertySpec[] = [...edgeSpecs('--ax-edge-'), len('--ax-corner-shoulder-radius', '0px')];

// For the host's shadow stylesheet. :host rules lose to every author declaration on the element
// (rules, inline styles, animations), so a property set anywhere wins over the shared one.
const fallbacks = [
    ...flatten(SIDES.map((s) => EDGE_PARAMS.map((p) => `--ax-edge-${s}-${p}: var(--ax-edge-${p});`))),
    ...CORNERS.map((c) => `--ax-corner-${c}-shoulder-radius: var(--ax-corner-shoulder-radius);`),
];
export const SHARED_FALLBACK_CSS = `:host { ${fallbacks.join(' ')} }`;

export const CORE_SCHEMA: PropertySpec[] = [
    lp('--ax-radius', '0px'),
    ...CORNERS.map((c) => lp(`--ax-${c}-radius`, '-1px')),
    kw('--ax-corner-shape', CORNER_SHAPES, 'round'),
    ...CORNERS.map((c) => kw(`--ax-corner-${c}-shape`, [...CORNER_SHAPES, 'auto'], 'auto')),
    ...CORNERS.map((c) => lp(`--ax-corner-${c}-shift-x`, '0px')),
    ...CORNERS.map((c) => lp(`--ax-corner-${c}-shift-y`, '0px')),
    ...CORNERS.map((c) => len(`--ax-corner-${c}-shoulder-radius`, '0px')),
    ...flatten(
        SIDES.map((s) => {
            // A flat edge ignores its feature parameters; skip reading them.
            const flat = { property: `--ax-edge-${s}-kind`, values: ['flat'] };
            return edgeSpecs(`--ax-edge-${s}-`).map((spec, i) => (i === 0 ? spec : { ...spec, skipWhen: flat }));
        })
    ),
    len('--ax-border-width', '1px'),
    ...SIDES.map((s) => len(`--ax-border-${s}-width`, '-1px')),
    // Tilt: appearance, inherited like the legacy --pressure-* properties.
    kw('--ax-tilt-mode', ['off', 'absolute', 'relative'], 'off', true),
    { ...len('--ax-tilt-depth', '1px', true), skipWhen: TILT_OFF },
    { ...num('--ax-tilt-factor', '2', true), skipWhen: TILT_OFF },
    { ...len('--ax-tilt-perspective', '25px', true), skipWhen: TILT_OFF },
    { ...len('--ax-tilt-zoom', '0.8px', true), skipWhen: TILT_OFF },
    { ...kw('--ax-tilt-direction', ['normal', 'inverted'], 'normal', true), skipWhen: TILT_OFF },
];

// Reads values out of a binding by property name.
export class Values {
    private index: { [name: string]: number } = {};
    values: PropertyValue[] = [];

    constructor(schema: PropertySpec[]) {
        schema.forEach((spec, i) => (this.index[spec.name] = i));
    }

    raw(name: string): PropertyValue {
        return this.values[this.index[name]];
    }

    length(name: string): number {
        const v = this.raw(name);
        return typeof v === 'number' ? v : 0;
    }

    // Resolves a length-percentage against `basis`.
    lp(name: string, basis: number): number {
        const v = this.raw(name) as LengthPercentage | null;
        return v ? v.px + (v.percent / 100) * basis : 0;
    }

    // True when the property holds the negative "use the general value" sentinel.
    unset(name: string): boolean {
        const v = this.raw(name) as LengthPercentage | number | null;
        if (v === null) return true;
        return typeof v === 'number' ? v < 0 : v.px < 0 && v.percent === 0;
    }

    number(name: string): number {
        const v = this.raw(name);
        return typeof v === 'number' ? v : 0;
    }

    keyword(name: string): string {
        const v = this.raw(name);
        return typeof v === 'string' ? v : '';
    }

    color(name: string): Rgba {
        const v = this.raw(name);
        return Array.isArray(v) ? v : [0, 0, 0, 0];
    }
}

// Property names built once; shapeSpecFrom runs on every style change of every surface.
const NAMES = {
    cornerRadius: CORNERS.map((c) => `--ax-${c}-radius`),
    cornerShape: CORNERS.map((c) => `--ax-corner-${c}-shape`),
    shiftX: CORNERS.map((c) => `--ax-corner-${c}-shift-x`),
    shiftY: CORNERS.map((c) => `--ax-corner-${c}-shift-y`),
    cornerShoulder: CORNERS.map((c) => `--ax-corner-${c}-shoulder-radius`),
    kind: SIDES.map((s) => `--ax-edge-${s}-kind`),
    depth: SIDES.map((s) => `--ax-edge-${s}-depth`),
    span: SIDES.map((s) => `--ax-edge-${s}-span`),
    at: SIDES.map((s) => `--ax-edge-${s}-at`),
    ratio: SIDES.map((s) => `--ax-edge-${s}-ratio`),
    tip: SIDES.map((s) => `--ax-edge-${s}-tip-radius`),
    shoulder: SIDES.map((s) => `--ax-edge-${s}-shoulder-radius`),
    borderSide: SIDES.map((s) => `--ax-border-${s}-width`),
};

export function shapeSpecFrom(v: Values, width: number, height: number): ShapeSpec {
    const min = Math.min(width, height);
    const generalRadius = v.lp('--ax-radius', min);
    const generalShape = v.keyword('--ax-corner-shape') as CornerShape;
    const corners = [0, 1, 2, 3].map((i) => {
        const shape = v.keyword(NAMES.cornerShape[i]);
        return {
            radius: v.unset(NAMES.cornerRadius[i]) ? generalRadius : v.lp(NAMES.cornerRadius[i], min),
            shape: (shape === 'auto' || !shape ? generalShape : shape) as CornerShape,
            shiftX: v.lp(NAMES.shiftX[i], width),
            shiftY: v.lp(NAMES.shiftY[i], height),
            shoulderRadius: v.length(NAMES.cornerShoulder[i]),
        };
    }) as ShapeSpec['corners'];
    const edges = [0, 1, 2, 3].map((i) => {
        const length = i % 2 === 0 ? width : height;
        return {
            kind: (v.keyword(NAMES.kind[i]) || 'flat') as EdgeKind,
            depth: v.length(NAMES.depth[i]),
            span: v.lp(NAMES.span[i], length),
            at: v.lp(NAMES.at[i], 100) / 100,
            ratio: v.number(NAMES.ratio[i]),
            tipRadius: v.length(NAMES.tip[i]),
            shoulderRadius: v.length(NAMES.shoulder[i]),
        };
    }) as ShapeSpec['edges'];
    return { width, height, corners, edges };
}

export function borderWidthsFrom(v: Values): Quad<number> {
    const general = Math.max(0, v.length('--ax-border-width'));
    return NAMES.borderSide.map((name) => (v.unset(name) ? general : Math.max(0, v.length(name)))) as Quad<number>;
}
