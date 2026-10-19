import { AxSurface } from './element.js';
import { createFillLayer } from './fill.js';
import { createFocusLayer } from './focus.js';
import { hasLayer, registerLayer } from './layer.js';
import { services } from './global.js';

export { AxSurface } from './element.js';
export { services } from './global.js';
export { StyleTriggers, composedContains } from './triggers.js';
export type { TriggerTarget } from './triggers.js';

// Re-reads the styles of every visible surface, for changes the triggers cannot see.
export function refreshAll(): void {
    services().triggers.refreshAll();
}
export type { PointerListener, PointerState, Services } from './global.js';
export { createLayer, hasLayer, registerLayer } from './layer.js';
export type { LayerFactory, LocalPointer, PaintBox, SurfaceFrame, SurfaceLayer } from './layer.js';
export type { MotionState } from './tilt.js';
export { WINDOWS_EASINGS, bezierAt, parseEasing, windowsEasing } from './easing.js';
export type { Bezier } from './easing.js';
export { Scheduler } from './scheduler.js';
export type { FrameClient, Quality } from './scheduler.js';
export { CORE_SCHEMA, Values, borderWidthsFrom, shapeSpecFrom } from './schema.js';
export { BORDER, SHAPE, TILT, BORDER_SCHEMA, SHAPE_SCHEMA, TILT_SCHEMA, SHARED_SCHEMA, SHARED_FALLBACK_CSS } from './schema.js';
export type { SchemaBundle } from './schema.js';
export { createFillLayer } from './fill.js';
export { createFocusLayer } from './focus.js';
export { appearance, setAlwaysUseFallback, useFallback } from './appearance.js';
export type { Appearance } from './appearance.js';

let registered = false;

// Defines <ax-surface> and the built-in layers. Safe to call more than once.
export function register(): void {
    if (registered) return;
    registered = true;
    // Another copy of this package may have registered it already.
    if (!hasLayer('fill')) registerLayer('fill', createFillLayer);
    if (!hasLayer('focus')) registerLayer('focus', createFocusLayer);
    if (!customElements.get(AxSurface.ElementName)) customElements.define(AxSurface.ElementName, AxSurface);
}
