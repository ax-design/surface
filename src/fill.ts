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

export function createFillLayer(): SurfaceLayer {
    let svg: SVGSVGElement;
    let fill: SVGPathElement;
    let ring: SVGPathElement;
    return {
        schema,
        attach(container) {
            svg = document.createElementNS(SVG_NS, 'svg');
            svg.setAttribute('aria-hidden', 'true');
            svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;';
            fill = document.createElementNS(SVG_NS, 'path');
            ring = document.createElementNS(SVG_NS, 'path');
            ring.setAttribute('fill-rule', 'evenodd');
            svg.appendChild(fill);
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
            svg.setAttribute('viewBox', `${paint.left} ${paint.top} ${paint.width} ${paint.height}`);
            const outline = toSvgPath(frame.shape.outline);
            fill.setAttribute('d', outline);
            fill.setAttribute('fill', css(frame.values.color('--ax-fill-color')));
            ring.setAttribute('d', `${outline} ${innerToSvgPath(frame.borderInner)}`);
            ring.setAttribute('fill', css(frame.values.color('--ax-border-color')));
            return false;
        },
    };
}
