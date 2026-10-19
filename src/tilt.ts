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

// A motion of the surface (see AxSurface.motion), as a CSS transform for a box whose
// transform-origin is the center of its layout box: the moves to and from the motion's origin
// put the rotation where the motion asks for it.
export interface MotionState {
    rotateX?: number;
    rotateY?: number;
    translateZ?: number;
    // px; default 1000.
    perspective?: number;
    // Local px; default the center of the surface. May lie outside it.
    originX?: number;
    originY?: number;
    // A 2D scale about the origin and a move in px, outside the perspective: the turned surface
    // is enlarged and moved as a picture (a launched tile flies toward the middle of the screen
    // while it turns, and stays a line when edge-on). Defaults 1, 0 and 0.
    scale?: number;
    x?: number;
    y?: number;
    // 0 to 1; default 1. Every layer applies it to its own drawing, none to an ancestor.
    opacity?: number;
}

export const MOTION_PERSPECTIVE = 1000;

export function motionTilt(m: MotionState, width: number, height: number): TiltParams {
    return {
        width,
        height,
        perspective: m.perspective === undefined ? MOTION_PERSPECTIVE : m.perspective,
        rotateX: m.rotateX || 0,
        rotateY: m.rotateY || 0,
        translateZ: m.translateZ || 0,
        originX: m.originX,
        originY: m.originY,
        scale: m.scale,
        x: m.x,
        y: m.y,
    };
}

// Whether the motion moves the surface at all (not only its opacity). The name is historical: a
// scale or a move counts too, since in Firefox no transform at all may sit above acrylic.
export function hasMotion3d(m: MotionState | null): boolean {
    return !!m && !!(m.rotateX || m.rotateY || m.translateZ || m.x || m.y || (m.scale !== undefined && m.scale !== 1));
}

export function motionTransform(m: MotionState, width: number, height: number): string {
    const t = motionTilt(m, width, height);
    const dx = (t.originX === undefined ? width / 2 : t.originX) - width / 2;
    const dy = (t.originY === undefined ? height / 2 : t.originY) - height / 2;
    const move = dx || dy;
    const outer = (t.x || t.y ? `translate(${t.x || 0}px, ${t.y || 0}px) ` : '') + (move ? `translate(${dx}px, ${dy}px) ` : '');
    const scale = t.scale !== undefined && t.scale !== 1 ? `scale(${t.scale}) ` : '';
    return outer + scale + tiltTransform(t) + (move ? ` translate(${-dx}px, ${-dy}px)` : '');
}
