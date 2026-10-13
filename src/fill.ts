import { innerToSvgPath, toSvgPath } from '@ax-design/shape';
import type { PropertySpec, Rgba } from '@ax-design/typed-om';
import type { SurfaceFrame, SurfaceLayer } from './layer.js';

// Built-in layer: the shape filled with --ax-fill-color and its border ring in
// --ax-border-color, drawn as SVG so it stays crisp at any zoom.

const SVG_NS = 'http://www.w3.org/2000/svg';

const schema: PropertySpec[] = [
    { name: '--ax-fill-color', syntax: { type: 'color' }, initial: 'rgba(0, 0, 0, 0)', inherits: true, register: true },
    { name: '--ax-border-color', syntax: { type: 'color' }, initial: 'rgba(0, 0, 0, 0)', inherits: true, register: true },
];

const css = (c: Rgba) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`;

let clipId = 0;

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
            if (!changed.style && !changed.size && !changed.tilt) return false;
            const { paint } = frame;
            set(svg, 'viewBox', `${paint.left} ${paint.top} ${paint.width} ${paint.height}`);
            const outline = toSvgPath(frame.shape.outline);
            const borderColor = css(frame.values.color('--ax-border-color'));
            set(fill, 'd', outline);
            set(fill, 'fill', css(frame.values.color('--ax-fill-color')));
            if (frame.uniformBorder !== null) {
                set(clipPath, 'd', outline);
                set(stroke, 'd', outline);
                set(stroke, 'stroke', borderColor);
                set(stroke, 'stroke-width', String(frame.uniformBorder * 2));
                set(ring, 'd', '');
            } else {
                set(stroke, 'd', '');
                set(ring, 'd', `${outline} ${innerToSvgPath(frame.borderInner)}`);
                set(ring, 'fill', borderColor);
            }
            return false;
        },
    };
}
