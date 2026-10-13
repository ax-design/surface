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
    pressed: boolean;
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
    // How far outside the shape the layer may paint, in px (glow, light radius).
    overflow?(frame: SurfaceFrame): number;
    attach(container: HTMLElement): void;
    detach(): void;
    // Draws the frame. Returns true to request another frame (running animation).
    write(frame: SurfaceFrame): boolean;
}

export type LayerFactory = () => SurfaceLayer;

const registry: { [name: string]: LayerFactory } = {};

export function registerLayer(name: string, factory: LayerFactory): void {
    if (registry[name]) throw new Error(`Surface layer "${name}" is already registered`);
    registry[name] = factory;
}

export function createLayer(name: string): SurfaceLayer | null {
    const factory = registry[name];
    return factory ? factory() : null;
}

export function layerSchema(name: string): PropertySpec[] {
    const layer = createLayer(name);
    return (layer && layer.schema) || [];
}
