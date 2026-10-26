import { apply, borderInner, invert, multiplyMatrix, planeHomography, projectContour, resolve, tiltMatrix, toSvgPath } from '@ax-design/shape';
import type { Homography, ResolvedShape, TiltParams } from '@ax-design/shape';
import { StyleBinding, StyleSchema } from '@ax-design/typed-om';
import type { LengthPercentage, PropertySpec, PropertyValue } from '@ax-design/typed-om';
import type { Quad, ShapeSpec } from '@ax-design/shape';
import type { TriggerTarget } from './triggers.js';
import { appearance } from './appearance.js';
import type { PointerListener, PointerState } from './global.js';
import { services } from './global.js';
import { createLayer, whenLayerRegistered } from './layer.js';
import type { LocalPointer, PaintBox, SurfaceFrame, SurfaceLayer } from './layer.js';
import { PRIORITY_IDLE, PRIORITY_POINTER, PRIORITY_PRESSED } from './scheduler.js';
import type { FrameClient, Quality } from './scheduler.js';
import { CORE_SCHEMA, Values, borderWidthsFrom, shapeSpecFrom } from './schema.js';
import { hasMotion3d, isResting, lerpTilt, motionTilt, motionTransform, restingTilt, tiltFor, tiltTransform } from './tilt.js';
import type { MotionState } from './tilt.js';
import type { Point, TiltParams as Tilt } from '@ax-design/shape';

const TILT_DURATION = 50;
// The content fades back in over this after a 3D motion hid it (Firefox, see motion()).
const CONTENT_FADE_MS = 167;

// The 2D affine transform closest to a tilt (least squares over the corners of the layout box),
// around the center of the layout box, the transform origin of the content and the containers.
function affineTilt(h: Homography, width: number, height: number): string {
    const cx = width / 2;
    const cy = height / 2;
    const corners = [
        [-cx, -cy],
        [cx, -cy],
        [cx, cy],
        [-cx, cy],
    ];
    // Normal equations of [x y 1] * [a c e] = x' and [x y 1] * [b d f] = y'.
    const m = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
    ];
    const vx = [0, 0, 0];
    const vy = [0, 0, 0];
    for (const [x, y] of corners) {
        const p = apply(h, { x: x + cx, y: y + cy });
        const row = [x, y, 1];
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) m[r][c] += row[r] * row[c];
            vx[r] += row[r] * (p.x - cx);
            vy[r] += row[r] * (p.y - cy);
        }
    }
    const [a, c, e] = solve3(m, vx);
    const [b, d, f] = solve3(m, vy);
    return `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`;
}

// Cramer's rule for a 3 x 3 system.
function solve3(m: number[][], v: number[]): number[] {
    const det = (k: number[][]) =>
        k[0][0] * (k[1][1] * k[2][2] - k[1][2] * k[2][1]) - k[0][1] * (k[1][0] * k[2][2] - k[1][2] * k[2][0]) + k[0][2] * (k[1][0] * k[2][1] - k[1][1] * k[2][0]);
    const d = det(m);
    return [0, 1, 2].map((col) => det(m.map((row, r) => row.map((value, c) => (c === col ? v[r] : value)))) / d);
}
// -moz-appearance exists in Gecko only.
const gecko = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('-moz-appearance', 'none');
// Extra paint area around the layout box. Zero: a canvas that sticks out of its element overlaps
// the neighbors, and an accelerated canvas overlapping other content makes the compositor
// promote that content too (Layerize and Paint tripled in the 1000-surface sweep). Outward
// features still grow the paint box to their bounds.
const ANTIALIAS_MARGIN = 0;

// Marks surface elements across copies of this package.
const SURFACE = typeof Symbol === 'function' && Symbol.for ? Symbol.for('@ax-design/surface.element') : '@ax-design/surface.element';

// Links and images inside a surface are not dragged out of it by the browser; an element that
// asks for it with draggable="true" still is.
function onDragStart(event: DragEvent) {
    const target = event.target as Element | null;
    if (target && target.closest && target.closest('[draggable="true"]')) return;
    event.preventDefault();
}

const STYLE = `
/* A surface is a control: pressing or dragging on it neither selects its text nor opens the
   long-press callout of iOS. :host rules lose to any style of the page. */
:host { display: inline-block; position: relative; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
:host([block]) { display: block; }
:host([flex]) { display: flex; }
:host([inline-flex]) { display: inline-flex; }
:host([grid]) { display: grid; }
:host([inline-grid]) { display: inline-grid; }
/* Only three positioned boxes per surface (host, layer drawing, content), like the legacy
   <ax-reveal>: every positioned box is a paint chunk the compositor walks on every frame a
   canvas changes. Layer containers take no box unless outward features grow the paint area
   beyond the layout box, or the surface tilts (a box made while tilting turns acrylic clear in
   Firefox, so a surface that can tilt keeps them).
   The tilt goes on each layer container and on the content, not on a common parent: inside
   position: sticky, Firefox renders a backdrop-filter under an animated 3D transform of an
   ancestor with the wrong backdrop. Layers that use one (acrylic) tilt their own elements. */
.tilt { width: 100%; height: 100%; }
.layers, .layers > div { display: contents; }
.layers.box { display: block; position: absolute; pointer-events: none; }
.layers.box > div, .layers > div.tilted { display: block; position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }
.content { position: relative; width: 100%; height: 100%; }
`;

// The style of a surface is one constructed sheet that every surface adopts (with those of its class, see
// extraSheets): a page of hundreds of surfaces, each a shadow root, would otherwise make and match a style
// element for each. A browser without constructable style sheets gets the style element in the template.
const adoptable =
    typeof CSSStyleSheet === 'function' && typeof Document !== 'undefined' && 'adoptedStyleSheets' in Document.prototype && 'replaceSync' in CSSStyleSheet.prototype;
let surfaceSheet: CSSStyleSheet | null = null;
// The sheets of each class, in the order of the cascade: the surface's, then those of the class.
const sheetLists = new WeakMap<object, CSSStyleSheet[]>();

function sheetsFor(cls: typeof AxSurface): CSSStyleSheet[] {
    let list = sheetLists.get(cls);
    if (!list) {
        if (!surfaceSheet) {
            surfaceSheet = new CSSStyleSheet();
            surfaceSheet.replaceSync(STYLE);
        }
        list = [surfaceSheet, ...cls.extraSheets()];
        sheetLists.set(cls, list);
    }
    return list;
}

const template = typeof document !== 'undefined' ? document.createElement('template') : null;
if (template) template.innerHTML = `${adoptable ? '' : `<style>${STYLE}</style>`}<div class="tilt"><div class="layers"></div><div class="content"><slot></slot></div></div>`;

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
        return ['layers', 'observe', 'clip'];
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
    // A press started by press(): the point in the untilted plane (null for the center), its
    // pointer type, and whether release() ended it.
    private apiPress: { at: Point | null; pointerType: string; released: boolean } | null = null;
    private takenOver = false;

    private tiltChanged = false;
    // The motion set by motion(), and whether the layers have drawn it yet.
    private motionState: MotionState | null = null;
    private motionDirty = false;
    // Firefox: the content is hidden during a 3D motion and fades back in from this time.
    private contentHidden = false;
    private contentFadeStart = -1;
    private contentOpacity = '';
    // The paint box of the untilted shape. In Firefox a 3D motion is drawn by the layers in flat
    // containers, so the paint box grows to the projected shape meanwhile (paintMoved).
    private flatPaint: PaintBox = { left: 0, top: 0, width: 0, height: 0 };
    private paintMoved = false;
    // The appearance version the layers last drew with.
    private appearanceSeen = -1;
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
    // Found the first time it is asked for (the walk up the composed tree costs more the deeper the
    // page is, and a surface that is paused or out of view never needs it), and again after each connect.
    private parentFound = false;
    private parentSurfaceNow: AxSurface | null = null;
    private get parentSurface(): AxSurface | null {
        if (!this.parentFound) {
            this.parentFound = true;
            this.parentSurfaceNow = null;
            for (let n: Node | null = this.parentNode || null; n; n = n.parentNode || (n as ShadowRoot).host || null) {
                // A brand rather than instanceof: the parent may come from another copy of this package.
                if ((n as unknown as { [SURFACE]?: boolean })[SURFACE as unknown as string]) {
                    this.parentSurfaceNow = n as unknown as AxSurface;
                    break;
                }
            }
        }
        return this.parentSurfaceNow;
    }
    get [SURFACE as unknown as string](): boolean {
        return true;
    }
    private offsetInParent: Point | null = null;

    // Whether this surface or one around it is tilted now.
    isTilted(): boolean {
        const parent = this.parentSurface;
        return !!this.homography || (!!parent && parent.isTilted());
    }

    private ancestorTilted(): boolean {
        const parent = this.parentSurface;
        return !!parent && parent.isTilted();
    }

    // A screen point in this surface's own plane, before its own tilt.
    private toUntiltedLocal(x: number, y: number): Point | null {
        const parent = this.parentSurface;
        if (parent && this.ancestorTilted()) {
            const o = this.offsetInParent;
            const p = o ? parent.toLocal(x, y) : null;
            return p && o ? { x: p.x - o.x, y: p.y - o.y } : null;
        }
        const r = this.rect || this.lastRect;
        if (!r) return null;
        // A scaled or zoomed ancestor (a page transition, a design preview, CSS zoom) makes the
        // bounding rect larger or smaller than the layout box while the pointer is in screen px.
        // Divide it back into local px. A tilt of this surface makes the rect the box around the
        // projected quad, where this ratio is not a scale; the homography below maps that.
        const sx = !this.homography && this.width ? r.width / this.width : 1;
        const sy = !this.homography && this.height ? r.height / this.height : 1;
        return { x: (x - r.left) / (sx > 0 ? sx : 1), y: (y - r.top) / (sy > 0 ? sy : 1) };
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
        // The clip is drawn all the time, like a static layer.
        if (this.pressPoint || this.apiPress || this.tiltNow || this.tiltTo || this.motionState || this.hasAttribute('clip')) return true;
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
        if (adoptable) this.root.adoptedStyleSheets = sheetsFor(this.constructor as typeof AxSurface);
        const copy = template!.content.cloneNode(true);
        // The tilt box is the last child (a style element may come before it), the layers and the content its children.
        const tilt = copy.lastChild as HTMLElement;
        this.layerBox = tilt.firstChild as HTMLElement;
        this.contentBox = tilt.lastChild as HTMLElement;
        this.root.appendChild(copy);
    }

    // Constructed style sheets of a class, added after the surface's own for every instance, in
    // the shadow root (built once per class, at its first instance). A subclass that styles its root
    // returns its sheets here instead of adding a style element to each instance.
    static extraSheets(): CSSStyleSheet[] {
        return [];
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
        this.parentFound = false;
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
        // A surface that shares the visibility of an element (its host) leaves the observer one target
        // instead of one per part; copies of this package older than 0.4.2 do not support it.
        this.visibilityElement = s.sharedVisibility ? this.visibilityTarget() : this;
        s.observeVisibility(this.visibilityElement, this.onVisibility);
        this.addEventListener('pointerdown', this.onPointerDown);
        this.addEventListener('dragstart', onDragStart);
    }

    disconnectedCallback() {
        this.connected = false;
        const s = services();
        s.unobserveSize(this);
        if (this.visibilityElement) s.unobserveVisibility(this.visibilityElement, this.onVisibility);
        this.visibilityElement = null;
        this.inView = false;
        s.pointerListeners.delete(this);
        appearance().listeners.delete(this.onAppearance);
        s.scheduler.cancel(this);
        this.removeEventListener('pointerdown', this.onPointerDown);
        this.removeEventListener('dragstart', onDragStart);
        this.stopObserving();
        this.pendingLayers.forEach((cancel) => cancel());
        this.pendingLayers = [];
        this.visible = false;
    }

    private visibilityElement: Element | null = null;
    // In the viewport (what the page's observer says), and not paused: only then does the surface run frames.
    private inView = false;
    private pausedNow = false;
    private onVisibility = (visible: boolean) => {
        this.inView = visible;
        this.setVisible(visible && !this.pausedNow);
    };

    /**
     * A paused surface runs no frame, reads no style and draws nothing, as one outside the viewport,
     * until it is resumed (paused = false), which draws it again at once. For a surface that is
     * known to show nothing for a while (a part of a component that is faded out): a page with
     * hundreds of them then costs nothing until they show.
     */
    get paused(): boolean {
        return this.pausedNow;
    }

    set paused(on: boolean) {
        if (on === this.pausedNow) return;
        this.pausedNow = on;
        this.setVisible(this.inView && !on);
    }

    /**
     * The element whose visibility in the viewport is this surface's. Its own box by default. A surface
     * that always lies inside another element's box (the parts of a component, in the component's
     * shadow root) may return that element: the page then watches one element for all of them, which
     * matters when a component has dozens of surfaces.
     */
    protected visibilityTarget(): Element {
        return this;
    }

    private onLayerRegistered = () => {
        if (!this.connected) return;
        this.layerNames = [];
        this.buildLayers();
    };

    attributeChangedCallback(name: string) {
        if (!this.connected) return;
        if (name === 'layers') this.buildLayers();
        else if (name === 'clip') {
            this.clipKey = null;
            this.styleDirty = true;
            this.requestFrame();
        } else if (this.visible) {
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

    // Layer DOM is created on first visibility: off-screen surfaces cost one shadow root. It is made in
    // the write phase of the surface's first frame (a visibility callback that wrote it would leave the page
    // with layout to flush for the first read of the next frame, which would be that of some other client).
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
            // Entering the viewport: one read in the next frame, then observe changes.
            this.styleDirty = true;
            this.startObserving();
            if (this.layers.some((l) => l.tracksPointer)) s.pointerListeners.add(this);
            appearance().listeners.add(this.onAppearance);
            this.requestFrame();
        } else {
            this.stopObserving();
            s.pointerListeners.delete(this);
            appearance().listeners.delete(this.onAppearance);
        }
    }

    // A preference changed: draw a frame, whose `changed.appearance` tells the layers. Hidden
    // surfaces catch up when they become visible, from the version.
    private onAppearance = () => this.requestFrame();

    private onStyleChange = () => {
        this.styleDirty = true;
        this.requestFrame();
    };

    onPointer(_state: PointerState, type: string) {
        if (type === 'pointerup' || type === 'pointercancel' || type === 'pointerleave') this.endPointerPress();
        this.pointerDirty = true;
        this.requestFrame();
    }

    private onPointerDown = (event: PointerEvent) => {
        this.pressPoint = { x: event.clientX, y: event.clientY };
        this.released = false;
        this.takenOver = false;
        this.tiltDirty = true;
        const s = services();
        // Releases arrive on the window; listen while pressed even without pointer layers.
        s.pointerListeners.add(this);
        this.requestFrame();
    };

    // A pointer press is in progress: a pointer press wins over one from press().
    private pointerPressing(): boolean {
        return !!this.pressPoint && !this.released;
    }

    // Presses the surface as a pointer press does, without a pointer (a keyboard press). `at` is in
    // local coordinates of the untilted surface; the default is the center of the layout box. The
    // layers see it as a pressed pointer, with pointerType 'keyboard' at the center and 'api' at a
    // point. A pointer press in progress wins over it.
    press(at?: { x: number; y: number } | 'center'): void {
        const spot = at && at !== 'center' ? { x: at.x, y: at.y } : null;
        this.apiPress = { at: spot, pointerType: spot ? 'api' : 'keyboard', released: false };
        this.takenOver = false;
        this.tiltDirty = true;
        this.requestFrame();
    }

    // Where a press from press() is, in the untilted plane.
    private apiPoint(press: { at: Point | null }): Point {
        return press.at || { x: this.width / 2, y: this.height / 2 };
    }

    // Ends the press before the pointer is up: the tilt and the press effects of the layers go
    // back as on a release, and pressTakenOver tells that it was ended this way. Also ends a press
    // from press(). For a container that takes the gesture over, such as a tile drag.
    release(): void {
        if (this.pointerPressing()) this.takenOver = true;
        this.endPointerPress();
        this.endApiPress();
    }

    // True when release() ended the current or last pointer press before the pointer went up. The
    // next press, pointer or press(), resets it.
    get pressTakenOver(): boolean {
        return this.takenOver;
    }

    // Milliseconds until the press feedback of this surface has finished: the longest of the
    // layers' pressRemaining() and the tilt tween, which is instant with reduced motion.
    pressRemaining(): number {
        const now = performance.now();
        let ms = 0;
        for (const layer of this.layers) if (layer.pressRemaining) ms = Math.max(ms, layer.pressRemaining(now));
        if (this.tiltTo && !appearance().reducedMotion) ms = Math.max(ms, this.tiltStart + TILT_DURATION - now);
        return Math.max(0, ms);
    }

    private endPointerPress() {
        if (!this.pointerPressing()) return;
        this.released = true;
        this.tiltDirty = true;
        if (!this.layers.some((l) => l.tracksPointer)) services().pointerListeners.delete(this);
        this.requestFrame();
    }

    private endApiPress() {
        if (!this.apiPress || this.apiPress.released) return;
        this.apiPress.released = true;
        this.tiltDirty = true;
        this.requestFrame();
    }

    // Hidden surfaces only collect dirty flags; becoming visible schedules the frame.
    private requestFrame() {
        if (this.connected && this.visible) services().scheduler.request(this);
    }

    // Pressed first, then under the pointer, then near and large surfaces: area over the
    // squared distance from the pointer to the surface (from the last measured rect).
    priority(): number {
        if (this.pointerPressing() || (this.apiPress && !this.apiPress.released)) return PRIORITY_PRESSED;
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
            // An author transition on this surface: keep reading every frame. getAnimations covers
            // engines that fire no events for custom property transitions; it is costly, so it runs only
            // right after a change and while an animation was running. It is asked here, in the read
            // phase, where the styles are clean (this read has just resolved them): in the write phase
            // it came after the writes of every surface before it, and flushed the styles again for each.
            // The first read cannot see a running transition: transitions start on changes.
            if (!this.precise && ((!same && this.reads > 1) || this.hostAnimating) && typeof this.getAnimations === 'function') {
                this.hostAnimating = this.mayAnimate() && this.getAnimations().length > 0;
            }
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
            this.paint = this.flatPaint = { left, top, width: right - left, height: bottom - top };
        }

        // Tilt target on press and release, then a short tween.
        // A press from press() needs no screen mapping.
        if (this.tiltDirty && (this.mappable || this.apiPress)) {
            const rest = restingTilt(this.width, this.height, this.tiltPerspective(v));
            const press = this.pointerPressing()
                ? this.toUntiltedLocal(this.pressPoint!.x, this.pressPoint!.y)
                : this.apiPress && !this.apiPress.released
                  ? this.apiPoint(this.apiPress)
                  : null;
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
            // Without animations the tilt takes its target at once, as theme animations of Windows
            // skip to their end.
            const t = appearance().reducedMotion ? 1 : Math.min(1, (now - this.tiltStart) / TILT_DURATION);
            this.tiltNow = lerpTilt(this.tiltFrom, this.tiltTo, t);
            tiltChanged = true;
            if (t >= 1) {
                this.tiltFrom = null;
                if (isResting(this.tiltTo)) this.tiltNow = null;
                this.tiltTo = null;
            }
        }
        if (tiltChanged || geometryDirty || this.motionDirty) {
            // The motion is outside the press tilt, as `transform: motion tilt`.
            const tilt = this.tiltNow ? tiltMatrix(this.tiltNow) : null;
            const motion = hasMotion3d(this.motionState) ? tiltMatrix(motionTilt(this.motionState!, this.width, this.height)) : null;
            const both = tilt && motion ? multiplyMatrix(motion, tilt) : motion || tilt;
            this.homography = both ? planeHomography(both) : null;
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

        // Firefox draws a 3D motion in flat containers: the paint box must hold the projected shape,
        // which a motion around an outside origin carries far from the element.
        if (tiltChanged || geometryDirty || this.motionDirty) {
            let next = this.flatPaint;
            if (gecko && hasMotion3d(this.motionState) && this.homography && this.shape) {
                const points = projectContour(this.shape.outline, this.homography, 1);
                const o = this.layerOverflow(v);
                let l = next.left, t = next.top, r = next.left + next.width, b = next.top + next.height;
                for (const q of points) {
                    l = Math.min(l, q.x - o[3]);
                    t = Math.min(t, q.y - o[0]);
                    r = Math.max(r, q.x + o[1]);
                    b = Math.max(b, q.y + o[2]);
                }
                next = { left: Math.floor(l), top: Math.floor(t), width: Math.ceil(r) - Math.floor(l), height: Math.ceil(b) - Math.floor(t) };
            }
            const p = this.paint;
            if (next.left !== p.left || next.top !== p.top || next.width !== p.width || next.height !== p.height) {
                this.paint = next;
                this.paintMoved = true;
            }
        }

        // Pointer in local coordinates, through the inverse tilt. A press from press() stands in for
        // the pointer, and its release keeps the point for one frame, so layers see the release.
        const pointer = services().pointer;
        const api = this.apiPress;
        const p = this.mappable && pointer.present ? this.toLocal(pointer.x, pointer.y) : null;
        if (api && !this.pointerPressing()) {
            const at = this.apiPoint(api);
            // pointerAllowed() asks where the pointer is (a reveal boundary); a press from the keyboard
            // or from code has no pointer, so it is never held back.
            this.local = { x: at.x, y: at.y, inside: true, pressed: !api.released, pointerType: api.pointerType };
        } else if (p && !this.pointerAllowed()) {
            this.local = null;
        } else if (p) {
            this.local = {
                x: p.x,
                y: p.y,
                inside: p.x >= 0 && p.y >= 0 && p.x <= this.width && p.y <= this.height,
                pressed: this.pointerPressing(),
                pointerType: pointer.pointerType,
            };
        } else if (!pointer.present) {
            this.local = null;
        }
        if (api && api.released) this.apiPress = null;
        this.tiltChanged = tiltChanged;
    }

    // Phase 3: DOM writes.
    write(now: number, quality: Quality) {
        const v = this.values;
        if (!v) return;
        this.attachLayers();
        if (!this.shape || this.geometryPending) {
            // Nothing to draw yet; layers keep their last (cleared) state.
            this.styleDirty = this.sizeDirty = this.pointerDirty = this.tiltDirty = false;
            return;
        }
        const look = appearance();
        const changed = {
            style: this.styleDirty || this.geometryFresh,
            size: this.sizeDirty || this.geometryFresh,
            // A motion changes the tilt the layers see too, so layers that only know changed.tilt
            // follow it.
            tilt: this.tiltChanged || this.motionDirty,
            pointer: this.pointerDirty,
            appearance: look.version !== this.appearanceSeen,
            motion: this.motionDirty,
        };
        this.motionDirty = false;
        // A paint box that grew for a projected motion is a size change for the layers (canvases).
        if (this.paintMoved) changed.size = true;
        this.paintMoved = false;
        this.appearanceSeen = look.version;
        this.geometryFresh = false;
        if (changed.style || changed.size) {
            // The stylesheet default covers the layout box plus the antialias margin. Inline
            // values are only written when outward features need more, so most surfaces never
            // trigger layout here.
            const p = this.paint;
            const m = ANTIALIAS_MARGIN;
            // Within 0.01 px: a shape in the middle of a transition resolves its bounds with
            // rounding errors, which used to switch the box on and off from frame to frame.
            const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
            const isDefault = near(p.left, -m) && near(p.top, -m) && near(p.width, this.width + 2 * m) && near(p.height, this.height + 2 * m);
            // A surface that can tilt keeps the box, as it keeps the boxes of its containers: a box
            // made or dropped while it tilts turns acrylic next to it clear in Firefox.
            const boxed = !isDefault || this.canTilt(v);
            // To 0.01 px, so rounding errors do not write the same box again every frame.
            const r = (n: number) => Math.round(n * 100) / 100;
            const key = boxed ? `${r(p.left)} ${r(p.top)} ${r(p.width)} ${r(p.height)}` : '';
            if (key !== this.paintKey) {
                this.paintKey = key;
                this.layerBox.className = boxed ? 'layers box' : 'layers';
                const s = this.layerBox.style;
                s.left = boxed ? `${r(p.left)}px` : '';
                s.top = boxed ? `${r(p.top)}px` : '';
                s.width = boxed ? `${r(p.width)}px` : '';
                s.height = boxed ? `${r(p.height)}px` : '';
            }
        }
        if (changed.style || changed.size || this.clipKey === null) this.writeClip();
        // Gecko: no 3D transform anywhere in the surface. Any of them, on any container, turns
        // the backdrop-filter of acrylic clear, so the content and the containers tilt with the
        // closest 2D transform instead (off by a fraction of a px at the depth of a tilt), and
        // acrylic cuts its glass to the exact projection of the outline.
        // A 3D motion goes further than a press tilt, where the closest 2D transform no longer looks
        // right: in Gecko the containers then stay flat, the layers draw the projected shape
        // themselves (frame.projected) and the content is hidden, then fades back in.
        const motion = this.motionState;
        const projected = gecko && hasMotion3d(motion);
        const tiltCss = this.tiltNow ? tiltTransform(this.tiltNow) : '';
        const motionCss = hasMotion3d(motion) ? motionTransform(motion!, this.width, this.height) : '';
        const transform = projected
            ? ''
            : gecko && this.homography
              ? affineTilt(this.homography, this.width, this.height)
              : [motionCss, tiltCss].filter(Boolean).join(' ');
        if (changed.tilt || changed.style || changed.size || changed.motion) this.writeTilt(transform);
        const opacity = motion && motion.opacity !== undefined ? Math.max(0, Math.min(1, motion.opacity)) : 1;
        if (projected) {
            this.contentHidden = true;
            this.contentFadeStart = -1;
        } else if (this.contentHidden) {
            this.contentHidden = false;
            this.contentFadeStart = now;
        }
        const fade = this.contentFadeStart < 0 || appearance().reducedMotion ? 1 : Math.min(1, (now - this.contentFadeStart) / CONTENT_FADE_MS);
        if (fade >= 1) this.contentFadeStart = -1;
        this.writeContentOpacity(this.contentHidden ? 0 : opacity * fade);

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
            appearance: look,
            opacity,
            projected,
            changed,
            quality,
            now,
        };
        let again = !!this.tiltTo || this.contentFadeStart >= 0;
        if (this.layersAttached) for (const layer of this.layers) if (layer.write(frame)) again = true;
        // The layers have drawn the opacity of this frame: shown again from this paint on.
        if (this.layersHidden && opacity > 0) this.writeLayersHidden(false);
        // An author transition on this surface or an ancestor: keep reading every frame (see read()).
        const readNext = !this.precise && (this.hostAnimating || services().triggers.isAnimating(this));
        if (readNext) again = true;
        this.animating = again;
        this.styleDirty = readNext;
        this.sizeDirty = this.pointerDirty = this.tiltDirty = false;
        this.tiltChanged = false;
        if (again) this.requestFrame();
    }

    /**
     * Moves the surface in 3D and fades it, for one frame: call it on every frame of an animation
     * with the state of that frame, and with null to end it. `rotateX` / `rotateY` (degrees),
     * `translateZ` (px) and `perspective` (px, default 1000) turn the surface around `originX` /
     * `originY` (local px, default its center; may lie outside it), outside its press tilt. `opacity`
     * fades it. Nothing is written on an ancestor of the layers: the layers draw the motion
     * themselves, so acrylic keeps its backdrop. In Firefox, where no 3D transform may sit above
     * acrylic, a 3D motion hides the content, which fades back in once the motion ends.
     */
    motion(state: MotionState | null): void {
        this.motionState = state ? { ...state } : null;
        this.motionDirty = true;
        // A motion that hides the content more than now does it at once: the next frame may come
        // after a paint (a surface not yet reported visible draws none), and the content would show
        // for that paint. Showing it again waits for the frame, which fades it in where it must.
        const target = state && gecko && hasMotion3d(state) ? 0 : state && state.opacity !== undefined ? Math.max(0, Math.min(1, state.opacity)) : 1;
        const now = this.contentOpacity === '' ? 1 : parseFloat(this.contentOpacity);
        // Not visible, no frame draws it: the content follows at once both ways.
        if (target < now || (!this.visible && target !== now)) {
            this.contentHidden = target === 0 && gecko && hasMotion3d(state);
            this.contentFadeStart = -1;
            this.writeContentOpacity(target);
        }
        // The layers draw the opacity in their frame, after this paint: a motion that hides the
        // surface hides them at once too, or the fill of a tile entering would show for a paint
        // at the opacity it had. The frame that draws them again at an opacity shows them.
        // visibility, not opacity: an opacity above acrylic would turn its blur clear.
        if (state && state.opacity !== undefined && state.opacity <= 0) this.writeLayersHidden(true);
        this.requestFrame();
    }

    private layersHidden = false;
    private writeLayersHidden(hidden: boolean) {
        if (hidden === this.layersHidden) return;
        this.layersHidden = hidden;
        this.layerBox.style.visibility = hidden ? 'hidden' : '';
    }

    private writeContentOpacity(value: number) {
        const css = value >= 1 ? '' : String(Math.round(value * 1000) / 1000);
        if (css === this.contentOpacity) return;
        this.contentOpacity = css;
        this.contentBox.style.opacity = css;
    }

    // clip: the content is cut to the shape (an image or a video in a tile). It is cut on the
    // content box, before its tilt, so the cut tilts with it.
    private clipKey: string | null = null;
    private writeClip() {
        const d = this.hasAttribute('clip') && this.shape ? `path("${toSvgPath(this.shape.outline)}")` : '';
        if (d === this.clipKey) return;
        this.clipKey = d;
        this.contentBox.style.setProperty('-webkit-clip-path', d);
        this.contentBox.style.setProperty('clip-path', d);
    }

    // Tilts the content and every layer container, except those of layers that tilt themselves.
    // A container covers the layout box, or the paint box when it is larger; the origin is the
    // center of the layout box either way.
    private canTilt(v: Values): boolean {
        const mode = v.keyword('--ax-tilt-mode');
        return mode === 'absolute' || mode === 'relative';
    }

    private writeTilt(transform: string) {
        const p = this.paint;
        const boxed = this.paintKey !== '';
        const origin = boxed ? `${this.width / 2 - p.left}px ${this.height / 2 - p.top}px` : '';
        // A surface that can tilt keeps the boxes of its layer containers, pressed or not: a box
        // made or dropped while the surface tilts turns the backdrop-filter of acrylic next to it
        // clear in Firefox.
        const tilts = !!this.values && this.canTilt(this.values);
        const key = `${transform}|${origin}|${this.containers.length}|${tilts}`;
        if (key === this.tiltKey) return;
        this.tiltKey = key;
        this.contentBox.style.transform = transform;
        this.containers.forEach((container, i) => {
            if (this.layers[i].tiltsItself) return;
            container.classList.toggle('tilted', tilts || !!transform);
            const s = container.style;
            s.transform = transform;
            s.transformOrigin = transform ? origin : '';
        });
    }

    // For tests and debugging.
    get debugState() {
        return { width: this.width, height: this.height, paint: this.paint, shape: this.shape, tilt: this.tiltNow, homography: this.homography, motion: this.motionState, local: this.local, values: this.values };
    }
}

