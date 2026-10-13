import { traceContour } from '@ax-design/shape';
import type { PropertySpec, Rgba } from '@ax-design/typed-om';
import type { SurfaceFrame, SurfaceLayer } from './layer.js';
import type { Values } from './schema.js';

// Built-in layer: a shadow that follows the shape, which box-shadow cannot do for anything but
// rounded rectangles. Like box-shadow it is cut out under the shape, so a translucent layer on
// top does not darken. Drawn with canvas shadows (every supported browser has them) and only
// when the style or the size changes.

const length = (name: string, initial: string): PropertySpec => ({ name, syntax: { type: 'length' }, initial, inherits: false, register: true });

const schema: PropertySpec[] = [
    { name: '--ax-shadow-color', syntax: { type: 'color' }, initial: 'rgba(0, 0, 0, 0.3)', inherits: true, register: true },
    length('--ax-shadow-blur', '12px'),
    length('--ax-shadow-x', '0px'),
    length('--ax-shadow-y', '4px'),
];

const css = (c: Rgba) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`;

export function createShadowLayer(): SurfaceLayer {
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    return {
        schema,
        static: true,
        overflow(v: Values) {
            // A canvas shadow blur of b is a gaussian of sigma b / 2; it fades out within 3 sigma.
            const reach = Math.ceil(Math.max(0, v.length('--ax-shadow-blur')) * 1.5);
            const x = v.length('--ax-shadow-x');
            const y = v.length('--ax-shadow-y');
            return [Math.max(0, reach - y), Math.max(0, reach + x), Math.max(0, reach + y), Math.max(0, reach - x)];
        },
        attach(container) {
            canvas = document.createElement('canvas');
            canvas.setAttribute('aria-hidden', 'true');
            canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;';
            ctx = canvas.getContext('2d');
            container.appendChild(canvas);
        },
        detach() {
            if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
            canvas = null;
            ctx = null;
        },
        write(frame: SurfaceFrame) {
            if (!canvas || !ctx || (!frame.changed.style && !frame.changed.size)) return false;
            const { paint, values } = frame;
            const ratio = window.devicePixelRatio || 1;
            const width = Math.ceil(paint.width * ratio);
            const height = Math.ceil(paint.height * ratio);
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            } else {
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.clearRect(0, 0, width, height);
            }
            const color = values.color('--ax-shadow-color');
            if (color[3] <= 0) return false;
            ctx.setTransform(ratio, 0, 0, ratio, -paint.left * ratio, -paint.top * ratio);
            // Shadow offsets and blur are in device pixels, unaffected by the transform.
            ctx.shadowColor = css(color);
            ctx.shadowBlur = Math.max(0, values.length('--ax-shadow-blur')) * ratio;
            ctx.shadowOffsetX = values.length('--ax-shadow-x') * ratio;
            ctx.shadowOffsetY = values.length('--ax-shadow-y') * ratio;
            ctx.fillStyle = '#000';
            ctx.beginPath();
            traceContour(ctx, frame.shape.outline);
            ctx.fill();
            // Cut the shape (and the shadow under it) out.
            ctx.shadowColor = 'rgba(0, 0, 0, 0)';
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
            return false;
        },
    };
}
