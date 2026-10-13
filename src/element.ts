import { apply, borderInner, invert, resolve, tiltHomography } from '@ax-design/shape';
import type { Homography, ResolvedShape, TiltParams } from '@ax-design/shape';
import { StyleBinding, StyleSchema } from '@ax-design/typed-om';
import type { LengthPercentage, PropertyValue } from '@ax-design/typed-om';
import type { TriggerTarget } from './triggers.js';
import type { PointerListener, PointerState } from './global.js';
import { services } from './global.js';
import { createLayer } from './layer.js';
import type { LocalPointer, PaintBox, SurfaceFrame, SurfaceLayer } from './layer.js';
import { PRIORITY_ANIMATING, PRIORITY_IDLE, PRIORITY_POINTER, PRIORITY_PRESSED } from './scheduler.js';
import type { FrameClient, Quality } from './scheduler.js';
import { CORE_SCHEMA, Values, borderWidthsFrom, shapeSpecFrom } from './schema.js';
import { isResting, lerpTilt, restingTilt, tiltFor, tiltTransform } from './tilt.js';

const TILT_DURATION = 50;
const ANTIALIAS_MARGIN = 2;

const STYLE = `
:host { display: inline-block; position: relative; }
:host([block]) { display: block; }
:host([flex]) { display: flex; }
:host([inline-flex]) { display: inline-flex; }
:host([grid]) { display: grid; }
:host([inline-grid]) { display: inline-grid; }
.tilt { position: relative; width: 100%; height: 100%; }
.layers { position: absolute; pointer-events: none; }
.layers > div { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
.content { position: relative; width: 100%; height: 100%; }
`;

const template = typeof document !== 'undefined' ? document.createElement('template') : null;
if (template) template.innerHTML = `<style>${STYLE}</style><div class="tilt"><div class="layers"></div><div class="content"><slot></slot></div></div>`;

// Schemas are compiled once per layer combination and shared by every surface using it.
const schemas: { [key: string]: StyleSchema } = {};
function schemaFor(names: string[], layers: SurfaceLayer[]): StyleSchema {
    const key = names.join(' ');
    if (!schemas[key]) {
        const seen = new Set<string>();
        const specs = CORE_SCHEMA.slice();
        for (const s of specs) seen.add(s.name);
        for (const layer of layers) for (const s of layer.schema || []) if (!seen.has(s.name)) (seen.add(s.name), specs.push(s));
        schemas[key] = new StyleSchema(specs);
    }
    return schemas[key];
}

function sameValue(a: PropertyValue, b: PropertyValue): boolean {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) && Array.isArray(b)) return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
    const x = a as LengthPercentage;
    const y = b as LengthPercentage;
    return x.px === y.px && x.percent === y.percent;
}

export class AxSurface extends HTMLElement implements FrameClient, PointerListener, TriggerTarget {
    static readonly ElementName = 'ax-surface';
    static get observedAttributes() {
        return ['layers', 'observe'];
    }

    private root: ShadowRoot;
    private tiltBox: HTMLElement;
    private layerBox: HTMLElement;
    private layers: SurfaceLayer[] = [];
    // Names from the attribute, and the names of the layers that exist (unknown ones skipped).
    private layerNames: string[] = [];
    private activeNames: string[] = [];
    private binding: StyleBinding | null = null;
    private values: Values | null = null;
    private connected = false;
    private visible = false;

    private width = 0;
    private height = 0;
    private shape: ResolvedShape | null = null;
    private paint: PaintBox = { left: 0, top: 0, width: 0, height: 0 };
    private borderWidths: [number, number, number, number] = [0, 0, 0, 0];
    private inner: { x: number; y: number }[] = [];

    private styleDirty = false;
    private sizeDirty = false;
    private pointerDirty = false;
    private tiltDirty = false;

    private tiltFrom: TiltParams | null = null;
    private tiltTo: TiltParams | null = null;
    private tiltStart = 0;
    private tiltNow: TiltParams | null = null;
    private homography: Homography | null = null;
    private pressPoint: { x: number; y: number } | null = null;
    private released = false;

    private tiltChanged = false;
    private previous: PropertyValue[] = [];
    private uniformBorder: number | null = null;
    private hostAnimating = false;
    private rect: DOMRect | null = null;
    private local: LocalPointer | null = null;
    private animating = false;

    constructor() {
        super();
        this.root = this.attachShadow({ mode: 'open' });
        this.root.appendChild(template!.content.cloneNode(true));
        this.tiltBox = this.root.querySelector('.tilt') as HTMLElement;
        this.layerBox = this.root.querySelector('.layers') as HTMLElement;
    }

    connectedCallback() {
        this.connected = true;
        this.buildLayers();
        const s = services();
        s.observeSize(this, (w, h) => {
            if (w === this.width && h === this.height) return;
            this.width = w;
            this.height = h;
            this.sizeDirty = true;
            this.requestFrame();
        });
        s.observeVisibility(this, (visible) => this.setVisible(visible));
        this.addEventListener('pointerdown', this.onPointerDown);
    }

    disconnectedCallback() {
        this.connected = false;
        const s = services();
        s.unobserveSize(this);
        s.unobserveVisibility(this);
        s.pointerListeners.delete(this);
        s.scheduler.cancel(this);
        this.removeEventListener('pointerdown', this.onPointerDown);
        this.stopObserving();
        this.visible = false;
    }

    attributeChangedCallback(name: string) {
        if (!this.connected) return;
        if (name === 'layers') this.buildLayers();
        else if (this.visible) {
            this.stopObserving();
            this.startObserving();
        }
    }

    // observe="precise": a detector per surface catches every change (selectors such as :has(),
    // third-party shadow roots) at about 95 us per page-wide change. Default: shared triggers.
    private get precise(): boolean {
        return this.getAttribute('observe') === 'precise';
    }

    private startObserving() {
        if (this.precise) {
            if (this.binding) this.binding.observe(this.onStyleChange);
        } else {
            services().triggers.add(this, this);
        }
    }

    private stopObserving() {
        if (this.binding) this.binding.unobserve();
        services().triggers.delete(this);
    }

    // Cheap filter before getAnimations, which costs several microseconds per call: a surface
    // can only animate if its computed style declares a transition or an animation.
    private mayAnimate(): boolean {
        const style = getComputedStyle(this);
        if (style.animationName && style.animationName !== 'none') return true;
        const durations = style.transitionDuration;
        return !!durations && /[1-9]/.test(durations);
    }

    // TriggerTarget, and public: re-read styles on the next frame.
    invalidateStyle() {
        this.styleDirty = true;
        this.requestFrame();
    }

    refresh() {
        this.invalidateStyle();
    }

    private buildLayers() {
        const names = (this.getAttribute('layers') || '').split(/\s+/).filter(Boolean);
        if (names.join(' ') === this.layerNames.join(' ') && this.binding) return;
        for (const layer of this.layers) layer.detach();
        this.layerBox.innerHTML = '';
        this.layers = [];
        this.activeNames = [];
        this.layerNames = names;
        this.layersAttached = false;
        for (const name of names) {
            const layer = createLayer(name);
            if (!layer) {
                // eslint-disable-next-line no-console
                console.warn(`ax-surface: unknown layer "${name}"`);
                continue;
            }
            this.layers.push(layer);
            this.activeNames.push(name);
        }
        if (this.visible) this.attachLayers();
        const schema = schemaFor(this.activeNames, this.layers);
        this.stopObserving();
        this.binding = new StyleBinding(schema, this, this.root);
        this.values = new Values(schema.specs);
        this.previous = [];
        this.styleDirty = true;
        if (this.visible) this.startObserving();
        this.requestFrame();
    }

    // Layer DOM is created on first visibility: off-screen surfaces cost one shadow root.
    private layersAttached = false;
    private attachLayers() {
        if (this.layersAttached) return;
        this.layersAttached = true;
        this.layers.forEach((layer, i) => {
            const container = document.createElement('div');
            container.className = `layer-${this.activeNames[i]}`;
            this.layerBox.appendChild(container);
            layer.attach(container);
        });
    }

    private setVisible(visible: boolean) {
        if (visible === this.visible) return;
        this.visible = visible;
        const s = services();
        if (visible) {
            // Entering the viewport: one forced read, then observe changes.
            this.attachLayers();
            this.styleDirty = true;
            this.startObserving();
            if (this.layers.some((l) => l.tracksPointer)) s.pointerListeners.add(this);
            this.requestFrame();
        } else {
            this.stopObserving();
            s.pointerListeners.delete(this);
        }
    }

    private onStyleChange = () => {
        this.styleDirty = true;
        this.requestFrame();
    };

    onPointer(_state: PointerState, type: string) {
        if (type === 'pointerup' || type === 'pointercancel' || type === 'pointerleave') this.release();
        this.pointerDirty = true;
        this.requestFrame();
    }

    private onPointerDown = (event: PointerEvent) => {
        this.pressPoint = { x: event.clientX, y: event.clientY };
        this.released = false;
        this.tiltDirty = true;
        const s = services();
        // Releases arrive on the window; listen while pressed even without pointer layers.
        s.pointerListeners.add(this);
        this.requestFrame();
    };

    private release() {
        if (!this.pressPoint || this.released) return;
        this.released = true;
        this.tiltDirty = true;
        if (!this.layers.some((l) => l.tracksPointer)) services().pointerListeners.delete(this);
    }

    // Hidden surfaces only collect dirty flags; becoming visible schedules the frame.
    private requestFrame() {
        if (this.connected && this.visible) services().scheduler.request(this);
    }

    priority(): number {
        if (this.pressPoint && !this.released) return PRIORITY_PRESSED;
        if (this.local && this.local.inside) return PRIORITY_POINTER;
        if (this.animating) return PRIORITY_ANIMATING;
        return PRIORITY_IDLE;
    }

    // Phase 1: style and layout reads only.
    read() {
        if (this.styleDirty && this.binding && this.values) {
            const next = this.binding.read();
            // Triggers are coarse: most re-reads find nothing new and stop here.
            let same = this.previous.length === next.length;
            for (let i = 0; same && i < next.length; i++) same = sameValue(this.previous[i], next[i]);
            if (same) this.styleDirty = false;
            this.previous = next.slice();
            this.values.values = next;
        }
        const pointer = services().pointer;
        const wantsPointer = this.pointerDirty || this.tiltDirty || this.animating;
        this.rect = wantsPointer && (pointer.present || this.pressPoint) ? this.getBoundingClientRect() : null;
    }

    // Phase 2: geometry, no DOM access.
    compute(now: number) {
        const v = this.values;
        if (!v || !this.width || !this.height) return;
        const geometryDirty = this.styleDirty || this.sizeDirty;
        if (geometryDirty) {
            this.borderWidths = borderWidthsFrom(v);
            this.shape = resolve(shapeSpecFrom(v, this.width, this.height), { borderWidths: this.borderWidths });
            const b = this.shape.bounds;
            const left = Math.min(0, b.left) - ANTIALIAS_MARGIN;
            const top = Math.min(0, b.top) - ANTIALIAS_MARGIN;
            const right = Math.max(this.width, b.right) + ANTIALIAS_MARGIN;
            const bottom = Math.max(this.height, b.bottom) + ANTIALIAS_MARGIN;
            this.paint = { left, top, width: right - left, height: bottom - top };
        }

        // Tilt target on press and release, then a short tween.
        if (this.tiltDirty && this.rect) {
            const rest = restingTilt(this.width, this.height, v.length('--ax-tilt-perspective'));
            const target =
                this.pressPoint && !this.released
                    ? tiltFor(v, this.width, this.height, this.pressPoint.x - this.rect.left, this.pressPoint.y - this.rect.top)
                    : rest;
            if (target) {
                this.tiltFrom = this.tiltNow || rest;
                this.tiltTo = target;
                this.tiltStart = now;
            }
            if (this.released) this.pressPoint = null;
        }
        let tiltChanged = false;
        if (this.tiltTo && this.tiltFrom) {
            const t = Math.min(1, (now - this.tiltStart) / TILT_DURATION);
            this.tiltNow = lerpTilt(this.tiltFrom, this.tiltTo, t);
            tiltChanged = true;
            if (t >= 1) {
                this.tiltFrom = null;
                if (isResting(this.tiltTo)) this.tiltNow = null;
                this.tiltTo = null;
            }
        }
        if (tiltChanged || geometryDirty) {
            this.homography = this.tiltNow ? tiltHomography(this.tiltNow) : null;
            const w = this.borderWidths;
            this.uniformBorder = !this.homography && w[0] === w[1] && w[1] === w[2] && w[2] === w[3] ? w[0] : null;
            if (this.uniformBorder !== null) {
                this.inner = [];
            } else if (this.shape) {
                this.inner = borderInner(this.shape.outline, {
                    widths: this.borderWidths,
                    transform: this.homography || undefined,
                    center: { x: this.width / 2, y: this.height / 2 },
                    tolerance: 0.1 / (window.devicePixelRatio || 1),
                }).inner;
            }
        }

        // Pointer in local coordinates, through the inverse tilt.
        const pointer = services().pointer;
        if (this.rect && pointer.present) {
            const screen = { x: pointer.x - this.rect.left, y: pointer.y - this.rect.top };
            const p = this.homography ? apply(invert(this.homography), screen) : screen;
            this.local = {
                x: p.x,
                y: p.y,
                inside: p.x >= 0 && p.y >= 0 && p.x <= this.width && p.y <= this.height,
                pressed: !!this.pressPoint && !this.released,
            };
        } else if (!pointer.present) {
            this.local = null;
        }
        this.tiltChanged = tiltChanged;
    }

    // Phase 3: DOM writes.
    write(now: number, quality: Quality) {
        const v = this.values;
        if (!v || !this.shape) return;
        const changed = { style: this.styleDirty, size: this.sizeDirty, tilt: this.tiltChanged, pointer: this.pointerDirty };
        if (changed.style || changed.size) {
            const s = this.layerBox.style;
            s.left = `${this.paint.left}px`;
            s.top = `${this.paint.top}px`;
            s.width = `${this.paint.width}px`;
            s.height = `${this.paint.height}px`;
        }
        if (changed.tilt) this.tiltBox.style.transform = this.tiltNow ? tiltTransform(this.tiltNow) : '';

        const frame: SurfaceFrame = {
            width: this.width,
            height: this.height,
            paint: this.paint,
            shape: this.shape,
            borderWidths: this.borderWidths,
            uniformBorder: this.uniformBorder,
            borderInner: this.inner,
            tilt: this.homography,
            pointer: this.local,
            values: v,
            changed,
            quality,
            now,
        };
        let again = !!this.tiltTo;
        if (this.layersAttached) for (const layer of this.layers) if (layer.write(frame)) again = true;
        // An author transition on this surface or an ancestor: keep reading every frame.
        // getAnimations covers engines that fire no events for custom property transitions; it
        // is costly, so it runs only right after a change and while an animation was running.
        if (!this.precise && (changed.style || this.hostAnimating) && typeof this.getAnimations === 'function') {
            this.hostAnimating = this.mayAnimate() && this.getAnimations().length > 0;
        }
        const readNext = !this.precise && (this.hostAnimating || services().triggers.isAnimating(this));
        if (readNext) again = true;
        this.animating = again;
        this.styleDirty = readNext;
        this.sizeDirty = this.pointerDirty = this.tiltDirty = false;
        this.tiltChanged = false;
        if (again) this.requestFrame();
    }

    // For tests and debugging.
    get debugState() {
        return { width: this.width, height: this.height, paint: this.paint, shape: this.shape, tilt: this.tiltNow, local: this.local, values: this.values };
    }
}

