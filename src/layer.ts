import type { Homography, Point, Quad, ResolvedShape } from '@ax-design/shape';
import type { PropertySpec } from '@ax-design/typed-om';
import type { Quality } from './scheduler.js';
import type { Values } from './schema.js';

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
    // True from a pointerdown on this surface until the release.
    pressed: boolean;
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
    // Current tilt of the surface, null when flat.
    tilt: Homography | null;
    // Null when no pointer is present or the surface does not track it.
    pointer: LocalPointer | null;
    values: Values;
    changed: { style: boolean; size: boolean; tilt: boolean; pointer: boolean };
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
    // Distance in px from the surface beyond which the layer draws nothing.
    reach?(width: number, height: number): number;
    // How far outside the shape the layer may paint, in px (glow, light radius).
    overflow?(frame: SurfaceFrame): number;
    attach(container: HTMLElement): void;
    detach(): void;
    // Draws the frame. Returns true to request another frame (running animation).
    write(frame: SurfaceFrame): boolean;
}

export type LayerFactory = () => SurfaceLayer;

const registry: { [name: string]: LayerFactory } = {};

// Surfaces waiting for a layer that was not registered yet, so the order in which packages
// register does not matter.
const waiting: { [name: string]: Set<() => void> } = {};

export function registerLayer(name: string, factory: LayerFactory): void {
    if (registry[name]) throw new Error(`Surface layer "${name}" is already registered`);
    registry[name] = factory;
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
