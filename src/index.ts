import { AxSurface } from './element.js';
import { createFillLayer } from './fill.js';
import { registerLayer } from './layer.js';

export { AxSurface } from './element.js';
export { services } from './global.js';
export type { PointerListener, PointerState, Services } from './global.js';
export { createLayer, registerLayer } from './layer.js';
export type { LayerFactory, LocalPointer, PaintBox, SurfaceFrame, SurfaceLayer } from './layer.js';
export { Scheduler } from './scheduler.js';
export type { FrameClient, Quality } from './scheduler.js';
export { CORE_SCHEMA, Values, borderWidthsFrom, shapeSpecFrom } from './schema.js';
export { createFillLayer } from './fill.js';

let registered = false;

// Defines <ax-surface> and the built-in layers. Safe to call more than once.
export function register(): void {
    if (registered) return;
    registered = true;
    registerLayer('fill', createFillLayer);
    if (!customElements.get(AxSurface.ElementName)) customElements.define(AxSurface.ElementName, AxSurface);
}
