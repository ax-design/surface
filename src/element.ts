import { apply, borderInner, invert, resolve, tiltHomography } from '@ax-design/shape';
import type { Homography, ResolvedShape, TiltParams } from '@ax-design/shape';
import { StyleBinding, StyleSchema } from '@ax-design/typed-om';
import type { LengthPercentage, PropertySpec, PropertyValue } from '@ax-design/typed-om';
import type { Quad, ShapeSpec } from '@ax-design/shape';
import type { TriggerTarget } from './triggers.js';
import type { PointerListener, PointerState } from './global.js';
import { services } from './global.js';
import { createLayer, whenLayerRegistered } from './layer.js';
import type { LocalPointer, PaintBox, SurfaceFrame, SurfaceLayer } from './layer.js';
import { PRIORITY_IDLE, PRIORITY_POINTER, PRIORITY_PRESSED } from './scheduler.js';
import type { FrameClient, Quality } from './scheduler.js';
import { CORE_SCHEMA, Values, borderWidthsFrom, shapeSpecFrom } from './schema.js';
import { isResting, lerpTilt, restingTilt, tiltFor, tiltTransform } from './tilt.js';
import type { Point, TiltParams as Tilt } from '@ax-design/shape';

const TILT_DURATION = 50;
// Extra paint area around the layout box. Zero: a canvas that sticks out of its element overlaps
// the neighbors, and an accelerated canvas overlapping other content makes the compositor
// promote that content too (Layerize and Paint tripled in the 1000-surface sweep). Outward
// features still grow the paint box to their bounds.
const ANTIALIAS_MARGIN = 0;

// Marks surface elements across copies of this package.
const SURFACE = typeof Symbol === 'function' && Symbol.for ? Symbol.for('@ax-design/surface.element') : '@ax-design/surface.element';

const STYLE = `
:host { display: inline-block; position: relative; }
:host([block]) { display: block; }
:host([flex]) { display: flex; }
:host([inline-flex]) { display: inline-flex; }
:host([grid]) { display: grid; }
:host([inline-grid]) { display: inline-grid; }
/* Only three positioned boxes per surface (host, layer drawing, content), like the legacy
   <ax-reveal>: every positioned box is a paint chunk the compositor walks on every frame a
   canvas changes. Layer containers take no box unless outward features grow the paint area
   beyond the layout box, or while they are tilted.
   The tilt goes on each layer container and on the content, not on a common parent: inside
   position: sticky, Firefox renders a backdrop-filter under an animated 3D transform of an
   ancestor with the wrong backdrop. Layers that use one (acrylic) tilt their own elements. */
.tilt { width: 100%; height: 100%; }
.layers, .layers > div { display: contents; }
.layers.box { display: block; position: absolute; pointer-events: none; }
.layers.box > div, .layers > div.tilted { display: block; position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }
.content { position: relative; width: 100%; height: 100%; }
`;

const template = typeof document !== 'undefined' ? document.createElement('template') : null;
if (template) template.innerHTML = `<style>${STYLE}</style><div class="tilt"><div class="layers"></div><div class="content"><slot></slot></div></div>`;

// Schemas are compiled once per element class and layer combination, and shared by every
// surface using it.
const schemas: { [key: string]: StyleSchema } = {};
function schemaFor(key: string, extra: PropertySpec[], layers: SurfaceLayer[]): StyleSchema {
    if (!schemas[key]) {
        const seen = new Set<string>();
        const specs = CORE_SCHEMA.slice();
        for (const s of specs) seen.add(s.name);
        const add = (s: PropertySpec) => {
            if (seen.has(s.name)) return;
            seen.add(s.name);
            specs.push(s);
        };
        extra.forEach(add);
        for (const layer of layers) (layer.schema || []).forEach(add);
        schemas[key] = new StyleSchema(specs);
    }
    return schemas[key];
}

// Server-side rendering imports this module without a DOM.
const ElementBase: typeof HTMLElement = typeof HTMLElement !== 'undefined' ? HTMLElement : (class {} as unknown as typeof HTMLElement);

function sameValue(a: PropertyValue, b: PropertyValue): boolean {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) && Array.isArray(b)) return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
    const x = a as LengthPercentage;
    const y = b as LengthPercentage;
    return x.px === y.px && x.percent === y.percent;
}

export class AxSurface extends ElementBase implements FrameClient, PointerListener, TriggerTarget {
    static readonly ElementName: string = 'ax-surface';
    static get observedAttributes() {
        return ['layers', 'observe'];
    }

    private root: ShadowRoot;
    private contentBox: HTMLElement;
    private layerBox: HTMLElement;
    // One per attached layer, in paint order.
    private containers: HTMLElement[] = [];
    // The tilt written to the containers and the content: transform and origin.
    private tiltKey = '';
    private layers: SurfaceLayer[] = [];
    private pendingLayers: (() => void)[] = [];
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
    private reads = 0;
    private geometryPending = false;
    private paintKey = '';
    // Nearest surface around this one. While it (or one of its ancestors) is tilted, this
    // surface's bounding rect is the box around a projected quad and useless for mapping the
    // pointer; the pointer goes through the ancestor's inverse tilt and this offset instead,
    // measured while no ancestor was tilted.
    private parentSurface: AxSurface | null = null;
    get [SURFACE as unknown as string](): boolean {
        return true;
    }
    private offsetInParent: Point | null = null;

    // Whether this surface or one around it is tilted now.
    isTilted(): boolean {
        return !!this.homography || (!!this.parentSurface && this.parentSurface.isTilted());
    }

    private ancestorTilted(): boolean {
        return !!this.parentSurface && this.parentSurface.isTilted();
    }

    // A screen point in this surface's own plane, before its own tilt.
    private toUntiltedLocal(x: number, y: number): Point | null {
        if (this.parentSurface && this.ancestorTilted()) {
            const o = this.offsetInParent;
            const p = o ? this.parentSurface.toLocal(x, y) : null;
            return p && o ? { x: p.x - o.x, y: p.y - o.y } : null;
        }
        const r = this.rect || this.lastRect;
        return r ? { x: x - r.left, y: y - r.top } : null;
    }

    // A screen point in this surface's local coordinates, through every tilt above and its own.
    toLocal(x: number, y: number): Point | null {
        const p = this.toUntiltedLocal(x, y);
        if (!p) return null;
        return this.homography ? apply(invert(this.homography), p) : p;
    }
    // Geometry computed this frame: layers must treat it as a style and size change.
    private geometryFresh = false;

    // Cached inner edge for flat surfaces with uniform borders (this.inner is empty then).
    private ringCache: { x: number; y: number }[] | null = null;
    private ringInner = (): { x: number; y: number }[] => {
        if (this.uniformBorder === null) return this.inner;
        if (!this.ringCache && this.shape) {
            this.ringCache = borderInner(this.shape.outline, {
                widths: this.borderWidths,
                tolerance: 0.1 / (window.devicePixelRatio || 1),
            }).inner;
        }
        return this.ringCache || [];
    };

    private needsGeometry(): boolean {
        if (this.pressPoint || this.tiltNow || this.tiltTo) return true;
        let reach = -1;
        for (const layer of this.layers) {
            if (layer.static) return true;
            if (layer.reach) reach = Math.max(reach, layer.reach(this.width, this.height));
        }
        const pointer = services().pointer;
        const r = this.rect || this.lastRect;
        if (reach < 0 || !pointer.present || !r) return false;
        const dx = Math.max(r.left - pointer.x, 0, pointer.x - r.right);
        const dy = Math.max(r.top - pointer.y, 0, pointer.y - r.bottom);
        return dx * dx + dy * dy <= reach * reach;
    }
    private rect: DOMRect | null = null;
    private lastRect: DOMRect | null = null;
    private local: LocalPointer | null = null;
    private animating = false;

    constructor() {
        super();
        this.root = this.attachShadow({ mode: 'open' });
        this.root.appendChild(template!.content.cloneNode(true));
        this.contentBox = this.root.querySelector('.content') as HTMLElement;
        this.layerBox = this.root.querySelector('.layers') as HTMLElement;
    }

    // Extension points for elements built on the surface (the legacy <ax-reveal> adapters).
    // Subclasses with their own extraSchema must set a unique schemaKey.
    static schemaKey = 'ax-surface';
    static extraSchema: PropertySpec[] = [];

    // Layers to build, in paint order. Default: the `layers` attribute.
    protected layerNames_(): string[] {
        return (this.getAttribute('layers') || '').split(/\s+/).filter(Boolean);
    }

    protected shapeFor(values: Values, width: number, height: number): ShapeSpec {
        return shapeSpecFrom(values, width, height);
    }

    protected borderWidthsFor(values: Values): Quad<number> {
        return borderWidthsFrom(values);
    }

    // The tilt toward a press at local (x, y); null for no tilt. Default: --ax-tilt-*.
    protected tiltParams(values: Values, width: number, height: number, x: number, y: number): Tilt | null {
        return tiltFor(values, width, height, x, y);
    }

    protected tiltPerspective(values: Values): number {
        return values.length('--ax-tilt-perspective');
    }

    // False hides the pointer from the layers (outside a reveal boundary).
    protected pointerAllowed(): boolean {
        return true;
    }

    // Style values of the last read, for subclasses.
    protected get currentValues(): Values | null {
        return this.values;
    }

    // The largest `overflow` of the layers on each side: [top, right, bottom, left].
    private layerOverflow(v: Values): Quad<number> {
        const o: Quad<number> = [0, 0, 0, 0];
        for (const layer of this.layers) {
            if (!layer.overflow) continue;
            const r = layer.overflow(v, this.width, this.height);
            for (let i = 0; i < 4; i++) {
                const side = typeof r === 'number' ? r : r[i];
                if (side > o[i]) o[i] = side;
            }
        }
        return o;
    }

    // The largest `reach` of the layers, for boundary tests.
    protected layerReach(): number {
        let reach = 0;
        for (const layer of this.layers) if (layer.reach) reach = Math.max(reach, layer.reach(this.width, this.height));
        return reach;
    }

    connectedCallback() {
        this.connected = true;
        this.parentSurface = null;
        for (let n: Node | null = this.parentNode || null; n; n = n.parentNode || (n as ShadowRoot).host || null) {
            // A brand rather than instanceof: the parent may come from another copy of this package.
            if ((n as unknown as { [SURFACE]?: boolean })[SURFACE as unknown as string]) {
                this.parentSurface = n as unknown as AxSurface;
                break;
            }
        }
        this.offsetInParent = null;
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
        this.pendingLayers.forEach((cancel) => cancel());
        this.pendingLayers = [];
        this.visible = false;
    }

    private onLayerRegistered = () => {
        if (!this.connected) return;
        this.layerNames = [];
        this.buildLayers();
    };

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
        const names = this.layerNames_();
        if (names.join(' ') === this.layerNames.join(' ') && this.binding && !this.pendingLayers.length) return;
        this.pendingLayers.forEach((cancel) => cancel());
        this.pendingLayers = [];
        for (const layer of this.layers) layer.detach();
        this.layerBox.innerHTML = '';
        this.containers = [];
        this.tiltKey = '';
        this.layers = [];
        this.activeNames = [];
        this.layerNames = names;
        this.layersAttached = false;
        for (const name of names) {
            const layer = createLayer(name);
            if (!layer) {
                // Rebuild once the layer gets registered.
                this.pendingLayers.push(whenLayerRegistered(name, this.onLayerRegistered));
                continue;
            }
            this.layers.push(layer);
            this.activeNames.push(name);
        }
        if (this.visible) this.attachLayers();
        const ctor = this.constructor as typeof AxSurface;
        const schema = schemaFor(`${ctor.schemaKey}|${this.activeNames.join(' ')}`, ctor.extraSchema, this.layers);
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
            this.containers.push(container);
            layer.attach(container);
        });
        this.tiltKey = '';
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

    // Pressed first, then under the pointer, then near and large surfaces: area over the
    // squared distance from the pointer to the surface (from the last measured rect).
    priority(): number {
        if (this.pressPoint && !this.released) return PRIORITY_PRESSED;
        if (this.local && this.local.inside) return PRIORITY_POINTER;
        const pointer = services().pointer;
        const r = this.lastRect;
        if (!r || !pointer.present) return this.animating ? 1 : PRIORITY_IDLE;
        const dx = Math.max(r.left - pointer.x, 0, pointer.x - r.right);
        const dy = Math.max(r.top - pointer.y, 0, pointer.y - r.bottom);
        const d = Math.sqrt(dx * dx + dy * dy);
        return (this.width * this.height) / ((1 + d) * (1 + d));
    }

    // Phase 1: style and layout reads only.
    read() {
        if (this.styleDirty && this.binding && this.values) {
            const next = this.binding.read();
            this.reads++;
            // Triggers are coarse: most re-reads find nothing new and stop here.
            let same = this.previous.length === next.length;
            for (let i = 0; same && i < next.length; i++) same = sameValue(this.previous[i], next[i]);
            if (same) this.styleDirty = false;
            this.previous = next.slice();
            this.values.values = next;
        }
        const pointer = services().pointer;
        const wantsPointer = this.pointerDirty || this.tiltDirty || this.animating;
        const tiltedAbove = this.ancestorTilted();
        this.rect = wantsPointer && (pointer.present || this.pressPoint) && !tiltedAbove ? this.getBoundingClientRect() : null;
        if (this.rect) {
            this.lastRect = this.rect;
            if (this.parentSurface) {
                const pr = this.parentSurface.getBoundingClientRect();
                this.offsetInParent = { x: this.rect.left - pr.left, y: this.rect.top - pr.top };
            }
        }
        this.mappable = !!this.rect || (tiltedAbove && !!this.offsetInParent);
    }

    // The pointer can be mapped into this surface this frame.
    private mappable = false;

    // Phase 2: geometry, no DOM access.
    compute(now: number) {
        const v = this.values;
        if (!v || !this.width || !this.height) return;
        // Geometry is computed when a layer can use it; otherwise it waits (geometryPending).
        const geometryDirty = (this.styleDirty || this.sizeDirty || this.geometryPending) && this.needsGeometry();
        if (this.styleDirty || this.sizeDirty) this.geometryPending = true;
        if (geometryDirty) {
            this.geometryPending = false;
            this.geometryFresh = true;
            this.borderWidths = this.borderWidthsFor(v);
            this.shape = resolve(this.shapeFor(v, this.width, this.height), { borderWidths: this.borderWidths });
            const b = this.shape.bounds;
            const o = this.layerOverflow(v);
            const left = Math.min(0, b.left - o[3]) - ANTIALIAS_MARGIN;
            const top = Math.min(0, b.top - o[0]) - ANTIALIAS_MARGIN;
            const right = Math.max(this.width, b.right + o[1]) + ANTIALIAS_MARGIN;
            const bottom = Math.max(this.height, b.bottom + o[2]) + ANTIALIAS_MARGIN;
            this.paint = { left, top, width: right - left, height: bottom - top };
        }

        // Tilt target on press and release, then a short tween.
        if (this.tiltDirty && this.mappable) {
            const rest = restingTilt(this.width, this.height, this.tiltPerspective(v));
            const press = this.pressPoint && !this.released ? this.toUntiltedLocal(this.pressPoint.x, this.pressPoint.y) : null;
            const target = press ? this.tiltParams(v, this.width, this.height, press.x, press.y) : rest;
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
            this.ringCache = null;
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
        const p = this.mappable && pointer.present ? this.toLocal(pointer.x, pointer.y) : null;
        if (p && !this.pointerAllowed()) {
            this.local = null;
        } else if (p) {
            this.local = {
                x: p.x,
                y: p.y,
                inside: p.x >= 0 && p.y >= 0 && p.x <= this.width && p.y <= this.height,
                pressed: !!this.pressPoint && !this.released,
                pointerType: pointer.pointerType,
            };
        } else if (!pointer.present) {
            this.local = null;
        }
        this.tiltChanged = tiltChanged;
    }

    // Phase 3: DOM writes.
    write(now: number, quality: Quality) {
        const v = this.values;
        if (!v) return;
        if (!this.shape || this.geometryPending) {
            // Nothing to draw yet; layers keep their last (cleared) state.
            this.styleDirty = this.sizeDirty = this.pointerDirty = this.tiltDirty = false;
            return;
        }
        const changed = {
            style: this.styleDirty || this.geometryFresh,
            size: this.sizeDirty || this.geometryFresh,
            tilt: this.tiltChanged,
            pointer: this.pointerDirty,
        };
        this.geometryFresh = false;
        if (changed.style || changed.size) {
            // The stylesheet default covers the layout box plus the antialias margin. Inline
            // values are only written when outward features need more, so most surfaces never
            // trigger layout here.
            const p = this.paint;
            const m = ANTIALIAS_MARGIN;
            const isDefault = p.left === -m && p.top === -m && p.width === this.width + 2 * m && p.height === this.height + 2 * m;
            const key = isDefault ? '' : `${p.left} ${p.top} ${p.width} ${p.height}`;
            if (key !== this.paintKey) {
                this.paintKey = key;
                this.layerBox.className = isDefault ? 'layers' : 'layers box';
                const s = this.layerBox.style;
                s.left = isDefault ? '' : `${p.left}px`;
                s.top = isDefault ? '' : `${p.top}px`;
                s.width = isDefault ? '' : `${p.width}px`;
                s.height = isDefault ? '' : `${p.height}px`;
            }
        }
        const transform = this.tiltNow ? tiltTransform(this.tiltNow) : '';
        if (changed.tilt || changed.style || changed.size) this.writeTilt(transform);

        const frame: SurfaceFrame = {
            width: this.width,
            height: this.height,
            paint: this.paint,
            shape: this.shape,
            borderWidths: this.borderWidths,
            uniformBorder: this.uniformBorder,
            borderInner: this.inner,
            ringInner: this.ringInner,
            tilt: this.homography,
            tiltTransform: transform,
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
        // The first read cannot see a running transition: transitions start on changes.
        if (!this.precise && ((changed.style && this.reads > 1) || this.hostAnimating) && typeof this.getAnimations === 'function') {
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

    // Tilts the content and every layer container, except those of layers that tilt themselves.
    // A container covers the layout box, or the paint box when it is larger; the origin is the
    // center of the layout box either way.
    private writeTilt(transform: string) {
        const p = this.paint;
        const boxed = this.paintKey !== '';
        const origin = boxed ? `${this.width / 2 - p.left}px ${this.height / 2 - p.top}px` : '';
        const key = transform && `${transform}|${origin}|${this.containers.length}`;
        if (key === this.tiltKey) return;
        this.tiltKey = key;
        this.contentBox.style.transform = transform;
        this.containers.forEach((container, i) => {
            if (this.layers[i].tiltsItself) return;
            container.classList.toggle('tilted', !!transform);
            const s = container.style;
            s.transform = transform;
            s.transformOrigin = transform ? origin : '';
        });
    }

    // For tests and debugging.
    get debugState() {
        return { width: this.width, height: this.height, paint: this.paint, shape: this.shape, tilt: this.tiltNow, local: this.local, values: this.values };
    }
}

