import type { Homography, Point, Quad, ResolvedShape } from '@ax-design/shape';
import { canRegister, registerProperties } from '@ax-design/typed-om';
import type { PropertySpec } from '@ax-design/typed-om';
import type { Quality } from './scheduler.js';
import type { Values } from './schema.js';
import type { Appearance } from './appearance.js';

export interface PaintBox {
    // Relative to the surface's layout box. Negative when outward features overflow it.
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface LocalPointer {
    // Local coordinates on the untilted surface plane.
    x: number;
    y: number;
    inside: boolean;
    // True from a pointerdown on this surface, or from press(), until the release.
    pressed: boolean;
    // The pointer type of the press, or 'keyboard' and 'api' for press() without and with a point.
    pointerType: string;
}

export interface SurfaceFrame {
    width: number;
    height: number;
    paint: PaintBox;
    shape: ResolvedShape;
    borderWidths: Quad<number>;
    // The border width when all sides are equal and the surface is flat. Layers then draw the
    // ring as a stroke of twice this width clipped to the outline (exact and free). Otherwise
    // null, and `borderInner` holds the inner edge.
    uniformBorder: number | null;
    // Inner edge of the border ring in local coordinates, compensated for the current tilt.
    // Empty when uniformBorder is set.
    borderInner: Point[];
    // The inner edge in every case, computed on first use and cached with the geometry. For
    // layers that repaint every frame: filling a ring is much cheaper on a canvas than the
    // clipped stroke that uniformBorder allows.
    ringInner(): Point[];
    // Current tilt of the surface (the press tilt and the motion together), null when flat.
    tilt: Homography | null;
    // The tilt as a CSS transform for a box at the layout box, around its center; empty when
    // flat. For layers that set `tiltsItself`.
    tiltTransform: string;
    // Null when no pointer is present or the surface does not track it.
    pointer: LocalPointer | null;
    values: Values;
    // The user's display preferences: forced colors, reduced transparency and motion, and the
    // fallback the page asked for. `changed.appearance` is set on the first frame after any of
    // them changes, even when no style value did.
    appearance: Appearance;
    // The opacity of the surface's motion (see AxSurface.motion), 1 without one. Each layer
    // applies it to its own drawing: an opacity on an ancestor of a backdrop-filter would make
    // that ancestor the backdrop root.
    opacity: number;
    // True when the containers carry no transform and the layers draw the shape through `tilt`
    // themselves: in Firefox during a 3D motion, as no 3D transform may sit above acrylic there.
    // projectContour() of @ax-design/shape gives the outline on screen; the points of
    // ringInner() and borderInner go through apply(tilt, p). The content is hidden meanwhile.
    projected: boolean;
    changed: { style: boolean; size: boolean; tilt: boolean; pointer: boolean; appearance: boolean; motion: boolean };
    quality: Quality;
    now: number;
}

export interface SurfaceLayer {
    // Extra custom properties this layer reads. Merged with the core schema.
    readonly schema?: PropertySpec[];
    // Layers that follow the pointer get frames on pointer movement while visible.
    readonly tracksPointer?: boolean;
    // Static layers draw without any pointer (fills, borders) and need the geometry at once.
    // For the others the surface computes the geometry lazily, when the pointer comes within
    // `reach` of the surface, when pressed or when tilted.
    readonly static?: boolean;
    // The surface tilts each layer's container. A layer with this flag gets an untilted
    // container and applies `tiltTransform` to its own elements instead. Layers with a
    // backdrop-filter need it: Firefox renders the backdrop wrong under a transformed ancestor
    // inside position: sticky.
    readonly tiltsItself?: boolean;
    // Distance in px from the surface beyond which the layer draws nothing.
    reach?(width: number, height: number): number;
    // How far outside the shape the layer paints, in px: one number for every side or
    // [top, right, bottom, left] (shadows, glows). The paint box grows by the largest request of
    // the layers. Called when the geometry is computed again (style or size changes), so the
    // result may depend on the layer's own properties. A paint box larger than the element
    // overlaps its neighbors, and the browser may then composite them separately: ask only for
    // what you draw.
    overflow?(values: Values, width: number, height: number): number | Quad<number>;
    attach(container: HTMLElement): void;
    detach(): void;
    // Draws the frame. Returns true to request another frame (running animation).
    write(frame: SurfaceFrame): boolean;
    // Milliseconds from `now` (performance.now()) until the press feedback of the layer, such as a
    // ripple, has finished. Layers without it count as finished.
    pressRemaining?(now: number): number;
}

export type LayerFactory = () => SurfaceLayer;

// Shared by every copy of this package on the page: a bundle may hold two copies (two
// versions installed side by side), and a layer registered by one is used by surfaces of the
// other.
interface Registry {
    factories: { [name: string]: LayerFactory };
    // Surfaces waiting for a layer that was not registered yet, so the order in which packages
    // register does not matter.
    waiting: { [name: string]: Set<() => void> };
}

const REGISTRY_KEY = typeof Symbol === 'function' && Symbol.for ? Symbol.for('@ax-design/surface.layers.v1') : '@ax-design/surface.layers.v1';

function shared(): Registry {
    const r = (typeof globalThis !== 'undefined' ? globalThis : window) as unknown as Record<string, Registry | undefined>;
    return r[REGISTRY_KEY as string] || (r[REGISTRY_KEY as string] = { factories: {}, waiting: {} });
}

const { factories: registry, waiting } = shared();

export function hasLayer(name: string): boolean {
    return !!registry[name];
}

export function registerLayer(name: string, factory: LayerFactory): void {
    if (registry[name]) throw new Error(`Surface layer "${name}" is already registered`);
    registry[name] = factory;
    // The properties of the layer are registered with the browser now, with the layer, not when the first
    // surface that uses it builds its schema: registering a property invalidates the style of the whole
    // page, and one that happens when a component first appears (a card, a glyph) finds the page grown.
    if (canRegister()) {
        const schema = factory().schema;
        if (schema) registerProperties(schema);
    }
    const callbacks = waiting[name];
    if (!callbacks) return;
    delete waiting[name];
    callbacks.forEach((callback) => callback());
}

export function whenLayerRegistered(name: string, callback: () => void): () => void {
    (waiting[name] || (waiting[name] = new Set())).add(callback);
    return () => {
        if (waiting[name]) waiting[name].delete(callback);
    };
}

export function createLayer(name: string): SurfaceLayer | null {
    const factory = registry[name];
    return factory ? factory() : null;
}

export function layerSchema(name: string): PropertySpec[] {
    const layer = createLayer(name);
    return (layer && layer.schema) || [];
}
