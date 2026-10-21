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
// `auto` is the "use the general value" sentinel for per-side and per-corner properties.
const AUTO = ['auto'];

const lp = (name: string, initial: string, keywords?: string[]): PropertySpec => ({
    name,
    syntax: keywords ? { type: 'length-percentage', keywords } : { type: 'length-percentage' },
    initial,
    inherits: false,
    register: true,
});
const len = (name: string, initial: string, inherits = false, keywords?: string[]): PropertySpec => ({
    name,
    syntax: keywords ? { type: 'length', keywords } : { type: 'length' },
    initial,
    inherits,
    register: true,
});
const num = (name: string, initial: string, inherits = false, keywords?: string[]): PropertySpec => ({
    name,
    syntax: keywords ? { type: 'number', keywords } : { type: 'number' },
    initial,
    inherits,
    register: true,
});
const kw = (name: string, values: string[], initial: string, inherits = false): PropertySpec => ({
    name,
    syntax: { type: 'keyword', values },
    initial,
    inherits,
    register: true,
});

const TILT_OFF = { property: '--ax-tilt-mode', values: ['off'] };

// The seven edge feature parameters. `auto` builds the per-side form, where every parameter
// falls back to the general `--ax-edge-*` value unless the side sets its own; the general form
// keeps the plain values because a general property never falls back. The sentinel is `auto`
// rather than a negative value because depth is a signed length (an inward feature).
function edgeSpecs(prefix: string, auto: boolean): PropertySpec[] {
    if (auto) {
        return [
            kw(`${prefix}kind`, [...EDGE_KINDS, 'auto'], 'auto'),
            len(`${prefix}depth`, 'auto', false, AUTO),
            lp(`${prefix}span`, 'auto', AUTO),
            lp(`${prefix}at`, 'auto', AUTO),
            num(`${prefix}ratio`, 'auto', false, AUTO),
            len(`${prefix}tip-radius`, 'auto', false, AUTO),
            len(`${prefix}shoulder-radius`, 'auto', false, AUTO),
        ];
    }
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

// Shape: the outline every layer draws, from the corners to the edge features.
export const SHAPE_SCHEMA: PropertySpec[] = [
    lp('--ax-radius', '0px'),
    ...CORNERS.map((c) => lp(`--ax-${c}-radius`, '-1px')),
    kw('--ax-corner-shape', CORNER_SHAPES, 'round'),
    ...CORNERS.map((c) => kw(`--ax-corner-${c}-shape`, [...CORNER_SHAPES, 'auto'], 'auto')),
    ...CORNERS.map((c) => lp(`--ax-corner-${c}-shift-x`, '0px')),
    ...CORNERS.map((c) => lp(`--ax-corner-${c}-shift-y`, '0px')),
    len('--ax-corner-shoulder-radius', '0px'),
    ...CORNERS.map((c) => len(`--ax-corner-${c}-shoulder-radius`, 'auto', false, AUTO)),
    // The general edge values each side falls back to when its own property is `auto`.
    ...edgeSpecs('--ax-edge-', false),
    ...flatten(
        SIDES.map((s) => {
            // A flat edge ignores its feature parameters; skip reading them.
            const flat = { property: `--ax-edge-${s}-kind`, values: ['flat'] };
            return edgeSpecs(`--ax-edge-${s}-`, true).map((spec, i) => (i === 0 ? spec : { ...spec, skipWhen: flat }));
        })
    ),
];

// Border: the ring the inner edge is computed from.
export const BORDER_SCHEMA: PropertySpec[] = [
    len('--ax-border-width', '1px'),
    ...SIDES.map((s) => len(`--ax-border-${s}-width`, '-1px')),
];

// Tilt: appearance, inherited like the legacy --pressure-* properties.
export const TILT_SCHEMA: PropertySpec[] = [
    kw('--ax-tilt-mode', ['off', 'absolute', 'relative'], 'off', true),
    { ...len('--ax-tilt-depth', '1px', true), skipWhen: TILT_OFF },
    { ...num('--ax-tilt-factor', '2', true), skipWhen: TILT_OFF },
    { ...len('--ax-tilt-perspective', '25px', true), skipWhen: TILT_OFF },
    { ...len('--ax-tilt-zoom', '0.8px', true), skipWhen: TILT_OFF },
    { ...kw('--ax-tilt-direction', ['normal', 'inverted'], 'normal', true), skipWhen: TILT_OFF },
];

// The three groups in the order the reader expects. The split keeps every name, syntax and
// initial value exactly as before, so a merged CORE_SCHEMA equals the unsplit one.
export const CORE_SCHEMA: PropertySpec[] = [...SHAPE_SCHEMA, ...BORDER_SCHEMA, ...TILT_SCHEMA];

// One group of the contract, with everything a consumer needs to adopt it alone.
export interface SchemaBundle {
    read: PropertySpec[];
}

export const SHAPE: SchemaBundle = { read: SHAPE_SCHEMA };
export const BORDER: SchemaBundle = { read: BORDER_SCHEMA };
export const TILT: SchemaBundle = { read: TILT_SCHEMA };

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

    // True when the property holds a "use the general value" sentinel: `auto`, or the older
    // negative sentinel (--ax-radius, --ax-{corner}-radius, --ax-border-{side}-width).
    unset(name: string): boolean {
        const v = this.raw(name) as LengthPercentage | number | string | null;
        if (v === null || v === 'auto') return true;
        if (typeof v === 'string') return false;
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
    // General values a per-side or per-corner property follows when it holds `auto`.
    const generalKind = v.keyword('--ax-edge-kind') as EdgeKind;
    const generalDepth = v.length('--ax-edge-depth');
    const generalSpan = v.raw('--ax-edge-span') as LengthPercentage | null;
    const generalAt = v.raw('--ax-edge-at') as LengthPercentage | null;
    const generalRatio = v.number('--ax-edge-ratio');
    const generalTip = v.length('--ax-edge-tip-radius');
    const generalShoulder = v.length('--ax-edge-shoulder-radius');
    const generalCornerShoulder = v.length('--ax-corner-shoulder-radius');

    const corners = [0, 1, 2, 3].map((i) => {
        const shape = v.keyword(NAMES.cornerShape[i]);
        const shoulder = v.raw(NAMES.cornerShoulder[i]);
        return {
            radius: v.unset(NAMES.cornerRadius[i]) ? generalRadius : v.lp(NAMES.cornerRadius[i], min),
            shape: (shape === 'auto' || !shape ? generalShape : shape) as CornerShape,
            shiftX: v.lp(NAMES.shiftX[i], width),
            shiftY: v.lp(NAMES.shiftY[i], height),
            shoulderRadius: shoulder === 'auto' ? generalCornerShoulder : v.length(NAMES.cornerShoulder[i]),
        };
    }) as ShapeSpec['corners'];
    const edges = [0, 1, 2, 3].map((i) => {
        const length = i % 2 === 0 ? width : height;
        const kind = v.keyword(NAMES.kind[i]);
        const depth = v.raw(NAMES.depth[i]);
        const span = v.raw(NAMES.span[i]);
        const at = v.raw(NAMES.at[i]);
        const ratio = v.raw(NAMES.ratio[i]);
        const tip = v.raw(NAMES.tip[i]);
        const shoulder = v.raw(NAMES.shoulder[i]);
        return {
            kind: (kind === 'auto' || !kind ? generalKind : kind) as EdgeKind,
            depth: depth === 'auto' ? generalDepth : v.length(NAMES.depth[i]),
            span: span === 'auto' ? (generalSpan ? generalSpan.px + (generalSpan.percent / 100) * length : 0) : v.lp(NAMES.span[i], length),
            at: (at === 'auto' ? (generalAt ? generalAt.px + (generalAt.percent / 100) * 100 : 0) : v.lp(NAMES.at[i], 100)) / 100,
            ratio: ratio === 'auto' ? generalRatio : v.number(NAMES.ratio[i]),
            tipRadius: tip === 'auto' ? generalTip : v.length(NAMES.tip[i]),
            shoulderRadius: shoulder === 'auto' ? generalShoulder : v.length(NAMES.shoulder[i]),
        };
    }) as ShapeSpec['edges'];
    return { width, height, corners, edges };
}

export function borderWidthsFrom(v: Values): Quad<number> {
    const general = Math.max(0, v.length('--ax-border-width'));
    return NAMES.borderSide.map((name) => (v.unset(name) ? general : Math.max(0, v.length(name)))) as Quad<number>;
}
