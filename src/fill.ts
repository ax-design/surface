import { apply, innerToSvgPath, projectContour, toSvgPath } from '@ax-design/shape';
import type { Point } from '@ax-design/shape';
import type { PropertySpec, Rgba } from '@ax-design/typed-om';
import type { SurfaceFrame, SurfaceLayer } from './layer.js';

// Built-in layer: the shape filled with --ax-fill-color and its border ring in
// --ax-border-color, drawn as SVG so it stays crisp at any zoom.
//
// Forced colors do not reach SVG fill and stroke, so the layer applies them itself, the way the
// browser treats a background and a border: the fill turns Canvas and keeps its alpha, and the
// border turns CanvasText, visible even where it was transparent.

const SVG_NS = 'http://www.w3.org/2000/svg';

const schema: PropertySpec[] = [
    { name: '--ax-fill-color', syntax: { type: 'color' }, initial: 'rgba(0, 0, 0, 0)', inherits: true, register: true },
    { name: '--ax-border-color', syntax: { type: 'color' }, initial: 'rgba(0, 0, 0, 0)', inherits: true, register: true },
];

const css = (c: Rgba) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`;
// Paints with the forced system color when there is one: a fill keeps the alpha of the author's
// color, as a forced background does, and a border is opaque, as a forced border is. The alpha
// goes in the opacity attribute, which every engine supports with a system color.
const paint = (el: Element, attribute: 'fill' | 'stroke', c: Rgba, forced: string | null) => {
    set(el, attribute, forced ? forced : css(c));
    set(el, `${attribute}-opacity`, forced && attribute === 'fill' ? String(c[3]) : '1');
};

let clipId = 0;

// A closed polyline as an SVG path.
export function polylinePath(points: Point[]): string {
    if (!points.length) return '';
    const r = (n: number) => Math.round(n * 1000) / 1000;
    return 'M' + points.map((p) => `${r(p.x)} ${r(p.y)}`).join('L') + 'Z';
}

// Sets an attribute only when the value differs; SVG attribute writes trigger style and layout.
function set(el: Element, name: string, value: string) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

export function createFillLayer(): SurfaceLayer {
    let svg: SVGSVGElement;
    let fill: SVGPathElement;
    // Uniform border: a stroke of twice the width, clipped to the outline.
    let stroke: SVGPathElement;
    let clipPath: SVGPathElement;
    // Uneven or tilted border: outline plus inner polyline, even-odd.
    let ring: SVGPathElement;
    return {
        schema,
        static: true,
        attach(container) {
            const id = `ax-fill-clip-${clipId++}`;
            svg = document.createElementNS(SVG_NS, 'svg');
            svg.setAttribute('aria-hidden', 'true');
            svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none;';
            const clip = document.createElementNS(SVG_NS, 'clipPath');
            clip.setAttribute('id', id);
            clipPath = document.createElementNS(SVG_NS, 'path');
            clip.appendChild(clipPath);
            fill = document.createElementNS(SVG_NS, 'path');
            stroke = document.createElementNS(SVG_NS, 'path');
            stroke.setAttribute('fill', 'none');
            stroke.setAttribute('stroke-linejoin', 'miter');
            stroke.setAttribute('stroke-miterlimit', '1000');
            stroke.setAttribute('clip-path', `url(#${id})`);
            ring = document.createElementNS(SVG_NS, 'path');
            ring.setAttribute('fill-rule', 'evenodd');
            svg.appendChild(clip);
            svg.appendChild(fill);
            svg.appendChild(stroke);
            svg.appendChild(ring);
            container.appendChild(svg);
        },
        detach() {
            if (svg && svg.parentNode) svg.parentNode.removeChild(svg);
        },
        write(frame: SurfaceFrame) {
            const { changed } = frame;
            if (!changed.style && !changed.size && !changed.tilt && !changed.appearance && !changed.motion) return false;
            const box = frame.paint;
            set(svg, 'viewBox', `${box.left} ${box.top} ${box.width} ${box.height}`);
            // Older copies of the surface engine give no opacity and never project.
            set(svg, 'opacity', frame.opacity === undefined || frame.opacity >= 1 ? '1' : String(frame.opacity));
            // Older copies of the surface engine give no appearance.
            const forced = !!frame.appearance && frame.appearance.forcedColors;
            const borderColor = frame.values.color('--ax-border-color');
            // A border nobody can see: the fill alone. An animated surface writes the shape every
            // frame, and a transparent border costs it a second element, a path and the clip on each
            // one. Forced colors make even a transparent border visible (see above), so the border is
            // drawn whenever they are on, whatever its color.
            const border = forced || borderColor[3] > 0;
            if (frame.projected && frame.tilt) {
                // The shape on screen, drawn flat: the container carries no transform (Firefox).
                const tilt = frame.tilt;
                const outlineOnScreen = polylinePath(projectContour(frame.shape.outline, tilt));
                set(fill, 'd', outlineOnScreen);
                paint(fill, 'fill', frame.values.color('--ax-fill-color'), forced ? 'Canvas' : null);
                set(stroke, 'd', '');
                if (border) {
                    set(ring, 'd', `${outlineOnScreen} ${polylinePath(frame.ringInner().map((p) => apply(tilt, p)))}`);
                    set(ring, 'fill', forced ? 'CanvasText' : css(borderColor));
                    set(ring, 'fill-opacity', '1');
                } else {
                    set(ring, 'd', '');
                }
                return false;
            }
            const outline = toSvgPath(frame.shape.outline);
            set(fill, 'd', outline);
            paint(fill, 'fill', frame.values.color('--ax-fill-color'), forced ? 'Canvas' : null);
            if (!border) {
                // Nothing of the border is drawn, and its path is left alone: written on every frame,
                // it would invalidate the clip and the stroke again for no pixels.
                set(stroke, 'd', '');
                set(ring, 'd', '');
                return false;
            }
            const borderPaint = forced ? 'CanvasText' : null;
            if (frame.uniformBorder !== null) {
                set(clipPath, 'd', outline);
                set(stroke, 'd', outline);
                paint(stroke, 'stroke', borderColor, borderPaint);
                set(stroke, 'stroke-width', String(frame.uniformBorder * 2));
                set(ring, 'd', '');
            } else {
                set(stroke, 'd', '');
                set(ring, 'd', `${outline} ${innerToSvgPath(frame.borderInner)}`);
                // The ring is a filled shape, but it stands for the border.
                set(ring, 'fill', borderPaint || css(borderColor));
                set(ring, 'fill-opacity', '1');
            }
            return false;
        },
    };
}
