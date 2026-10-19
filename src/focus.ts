import { projectContour, toSvgPath } from '@ax-design/shape';
import { polylinePath } from './fill.js';
import type { PropertySpec, Rgba } from '@ax-design/typed-om';
import type { SurfaceFrame, SurfaceLayer } from './layer.js';

// Built-in layer: the keyboard focus ring, around the shape rather than the layout box, so it
// follows any corner and edge. It is the focus visual of Windows: two rings outside the
// element, the secondary one (1 px, light) against it and the primary one (2 px, dark) around
// that. It shows while the surface or an element inside it matches :focus-visible.
//
// A ring is the band between two distances from the outline. It is drawn as a rectangle masked
// by a wide stroke of the outline, with the outline's fill and a narrower stroke cut away; the
// round joins of the strokes keep the band even around convex corners and inside notches.
// In forced colors the rings take CanvasText and Canvas, as the focus visual of Windows does in
// High Contrast.

const SVG_NS = 'http://www.w3.org/2000/svg';

const len = (name: string, initial: string): PropertySpec => ({ name, syntax: { type: 'length' }, initial, inherits: true, register: true });
const color = (name: string, initial: string): PropertySpec => ({ name, syntax: { type: 'color' }, initial, inherits: true, register: true });

// The defaults of the Windows focus visual in the light theme: FocusVisualPrimaryThickness 2,
// FocusVisualSecondaryThickness 1, SystemBaseHighColor and SystemAltMediumColor.
const schema: PropertySpec[] = [
    len('--ax-focus-ring-width', '2px'),
    len('--ax-focus-ring-secondary-width', '1px'),
    len('--ax-focus-ring-offset', '0px'),
    color('--ax-focus-ring-color', 'rgb(0, 0, 0)'),
    color('--ax-focus-ring-secondary-color', 'rgba(255, 255, 255, 0.6)'),
];

const css = (c: Rgba) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`;

let maskId = 0;

function set(el: Element, name: string, value: string) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function el<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
    const e = document.createElementNS(SVG_NS, name);
    for (const k in attributes) e.setAttribute(k, attributes[k]);
    return e;
}

// Engines throw on a selector they don't know. Firefox before 85 has :-moz-focusring, which
// matches the same keyboard focus; Safari before 15.4 has neither, and :focus is the closest.
const FOCUS_SELECTORS = [':focus-visible', ':-moz-focusring', ':focus'];
let focusSelector = 0;
function hasVisibleFocus(host: Element): boolean {
    const selector = FOCUS_SELECTORS[focusSelector];
    try {
        return host.matches(selector) || !!host.querySelector(selector);
    } catch (error) {
        if (focusSelector === FOCUS_SELECTORS.length - 1) throw error;
        focusSelector++;
        return hasVisibleFocus(host);
    }
}

interface Ring {
    mask: SVGMaskElement;
    // White: the outline stroked to the outer distance.
    outer: SVGPathElement;
    // Black: the outline filled and stroked to the inner distance.
    inner: SVGPathElement;
    paint: SVGRectElement;
}

export function createFocusLayer(): SurfaceLayer {
    let svg: SVGSVGElement;
    let rings: Ring[] = [];
    let host: Element | null = null;
    let shown = false;
    let drawn = '';

    // Focus moving in or out changes no custom property, and a surface with observe="precise"
    // watches only those: ask the surface for a frame directly.
    const onFocus = () => {
        if (host && typeof (host as unknown as { refresh?: () => void }).refresh === 'function') (host as unknown as { refresh: () => void }).refresh();
    };

    const ring = (): Ring => {
        const id = `ax-focus-ring-${maskId++}`;
        const mask = el('mask', { id, maskUnits: 'userSpaceOnUse' });
        const outer = el('path', { fill: 'none', stroke: 'white', 'stroke-linejoin': 'round' });
        const inner = el('path', { fill: 'black', stroke: 'black', 'stroke-linejoin': 'round' });
        mask.appendChild(outer);
        mask.appendChild(inner);
        const paint = el('rect', { mask: `url(#${id})` });
        return { mask, outer, inner, paint };
    };

    // The band from `from` to `to` px outside the outline.
    const band = (r: Ring, outline: string, from: number, to: number, box: { x: number; y: number; w: number; h: number }, fill: string) => {
        for (const e of [r.mask, r.paint]) {
            set(e, 'x', String(box.x));
            set(e, 'y', String(box.y));
            set(e, 'width', String(box.w));
            set(e, 'height', String(box.h));
        }
        set(r.outer, 'd', to > 0 ? outline : '');
        set(r.outer, 'stroke-width', String(to * 2));
        set(r.inner, 'd', outline);
        set(r.inner, 'stroke-width', String(from * 2));
        set(r.paint, 'fill', fill);
    };

    return {
        schema,
        // Focus comes without a pointer, so the geometry has to be ready at any time.
        static: true,
        attach(container) {
            svg = el('svg', { 'aria-hidden': 'true' });
            svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none;display:none;';
            const defs = el('defs', {});
            rings = [ring(), ring()];
            for (const r of rings) {
                defs.appendChild(r.mask);
                svg.appendChild(r.paint);
            }
            svg.insertBefore(defs, svg.firstChild);
            container.appendChild(svg);
            const root = container.getRootNode() as ShadowRoot;
            host = root && root.host ? root.host : null;
            if (host) {
                host.addEventListener('focusin', onFocus);
                host.addEventListener('focusout', onFocus);
            }
            shown = false;
            drawn = '';
        },
        detach() {
            if (host) {
                host.removeEventListener('focusin', onFocus);
                host.removeEventListener('focusout', onFocus);
            }
            host = null;
            if (svg && svg.parentNode) svg.parentNode.removeChild(svg);
        },
        write(frame: SurfaceFrame) {
            const visible = !!host && hasVisibleFocus(host);
            if (visible !== shown) {
                shown = visible;
                svg.style.display = visible ? '' : 'none';
            }
            if (!visible) return false;

            const v = frame.values;
            const offset = Math.max(0, v.length('--ax-focus-ring-offset'));
            const secondary = Math.max(0, v.length('--ax-focus-ring-secondary-width'));
            const primary = Math.max(0, v.length('--ax-focus-ring-width'));
            // Older copies of the surface engine give no appearance.
            const forced = !!frame.appearance && frame.appearance.forcedColors;
            const primaryFill = forced ? 'CanvasText' : css(v.color('--ax-focus-ring-color'));
            const secondaryFill = forced ? 'Canvas' : css(v.color('--ax-focus-ring-secondary-color'));
            // In Firefox during a 3D motion the container is flat and the ring goes around the
            // projected shape (frame.projected); older engines give no `projected`.
            const projected = frame.projected && frame.tilt ? projectContour(frame.shape.outline, frame.tilt) : null;
            const outline = projected ? polylinePath(projected) : toSvgPath(frame.shape.outline);
            const opacity = frame.opacity === undefined || frame.opacity >= 1 ? '1' : String(frame.opacity);
            const key = `${outline}|${offset}|${secondary}|${primary}|${primaryFill}|${secondaryFill}|${opacity}`;
            if (key === drawn) return false;
            drawn = key;

            const p = frame.paint;
            set(svg, 'viewBox', `${p.left} ${p.top} ${p.width} ${p.height}`);
            set(svg, 'opacity', opacity);
            const b = projected
                ? {
                      left: Math.min(...projected.map((q) => q.x)),
                      top: Math.min(...projected.map((q) => q.y)),
                      right: Math.max(...projected.map((q) => q.x)),
                      bottom: Math.max(...projected.map((q) => q.y)),
                  }
                : frame.shape.bounds;
            const reach = offset + secondary + primary + 1;
            const box = { x: b.left - reach, y: b.top - reach, w: b.right - b.left + 2 * reach, h: b.bottom - b.top + 2 * reach };
            band(rings[0], outline, offset, offset + secondary, box, secondaryFill);
            band(rings[1], outline, offset + secondary, offset + secondary + primary, box, primaryFill);
            return false;
        },
    };
}
