import type { TiltParams } from '@ax-design/shape';
import type { Values } from './schema.js';

// Tilt from the pointer position inside the surface, matching the legacy @ax-design/pressure
// formula: the surface leans away from the pressed point and sinks by --ax-tilt-zoom.
export function tiltFor(v: Values, width: number, height: number, localX: number, localY: number): TiltParams | null {
    const mode = v.keyword('--ax-tilt-mode');
    if (mode !== 'absolute' && mode !== 'relative') return null;
    const invert = v.keyword('--ax-tilt-direction') === 'inverted';
    const cx = localX - width / 2;
    const cy = localY - height / 2;
    let degX: number;
    let degY: number;
    if (mode === 'absolute') {
        const depth = v.length('--ax-tilt-depth');
        const sinX = Math.min(0.99, depth / (width / 2));
        const sinY = Math.min(0.99, depth / (height / 2));
        degX = (Math.asin(sinX) * 180) / Math.PI;
        degY = (Math.asin(sinY) * 180) / Math.PI;
    } else {
        degX = degY = v.number('--ax-tilt-factor');
    }
    const ax = (cx / width) * degX * (invert ? -1 : 1);
    const ay = (cy / height) * degY * (invert ? 1 : -1);
    const z = (cx * cx + cy * cy) / ((width / 2) ** 2 + (height / 2) ** 2) - 1;
    return {
        width,
        height,
        perspective: v.length('--ax-tilt-perspective'),
        rotateX: ay,
        rotateY: ax,
        translateZ: z * v.length('--ax-tilt-zoom'),
    };
}

export function restingTilt(width: number, height: number, perspective: number): TiltParams {
    return { width, height, perspective, rotateX: 0, rotateY: 0, translateZ: 0 };
}

export function lerpTilt(a: TiltParams, b: TiltParams, t: number): TiltParams {
    const l = (x: number, y: number) => x + (y - x) * t;
    return {
        width: b.width,
        height: b.height,
        perspective: b.perspective,
        rotateX: l(a.rotateX, b.rotateX),
        rotateY: l(a.rotateY, b.rotateY),
        translateZ: l(a.translateZ, b.translateZ),
    };
}

export function tiltTransform(t: TiltParams): string {
    return `perspective(${t.perspective}px) rotateX(${t.rotateX}deg) rotateY(${t.rotateY}deg) translateZ(${t.translateZ}px)`;
}

export function isResting(t: TiltParams): boolean {
    return Math.abs(t.rotateX) < 1e-4 && Math.abs(t.rotateY) < 1e-4 && Math.abs(t.translateZ) < 1e-4;
}
