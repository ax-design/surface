// The timing functions of the Windows 8 and 8.1 animation theme, by id, and a cubic-bezier
// evaluator for scripted animations (the tiles animate with requestAnimationFrame: Safari before
// 13.1 has no Web Animations API).

export type Bezier = [number, number, number, number];

// The control points (x1, y1, x2, y2) of the theme's curves. 1 to 62 are Windows 8; 63 to 65 came
// with 8.1. 53 is the first sign-in, 54 the Start screen coming in.
export const WINDOWS_EASINGS: { [id: number]: Bezier } = {
    1: [0, 0, 1, 1],
    2: [0.25, 0.1, 0.25, 1],
    3: [0, 0, 0.58, 1],
    4: [0.1, 0.9, 0.2, 1],
    5: [0.1, 0.25, 0.75, 0.9],
    6: [0.11, 0.5, 0.24, 0.96],
    49: [0.25, 0.1, 0.9, 0.75],
    50: [0.1, 0.25, 0.75, 1],
    51: [0.25, 0.5, 0.5, 1],
    52: [0.35, 2.2, 0.5, 1],
    53: [0, 0, 1, 1],
    54: [0, 0.5, 0.5, 1],
    58: [0.18, 0.7, 0.6, 1],
    59: [0.42, 0.47, 0.3, 0.95],
    60: [0.41, 0.52, 0, 0.94],
    61: [0.17, 0.55, 0.3, 0.95],
    62: [0.3, 0.34, 0.56, 0.79],
    63: [0.41, 0.52, 0.6, 1.4],
    64: [0.4, 1, 0.6, 1.8],
    65: [0.84, 0.21, 0.82, 0.72],
};

// The curve with that id as a CSS timing function.
export function windowsEasing(id: number): string {
    const b = WINDOWS_EASINGS[id];
    if (!b) throw new Error(`No Windows easing with id ${id}`);
    return `cubic-bezier(${b.join(', ')})`;
}

// Reads `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out` and `cubic-bezier(...)`, as a CSS
// custom property gives them; anything else is null.
export function parseEasing(value: string): Bezier | null {
    const v = value.trim();
    const named: { [name: string]: Bezier } = {
        linear: [0, 0, 1, 1],
        ease: [0.25, 0.1, 0.25, 1],
        'ease-in': [0.42, 0, 1, 1],
        'ease-out': [0, 0, 0.58, 1],
        'ease-in-out': [0.42, 0, 0.58, 1],
    };
    if (named[v]) return named[v];
    const m = /^cubic-bezier\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)$/.exec(v);
    if (!m) return null;
    const n = [m[1], m[2], m[3], m[4]].map(Number);
    if (n.some((x) => !isFinite(x)) || n[0] < 0 || n[0] > 1 || n[2] < 0 || n[2] > 1) return null;
    return n as Bezier;
}

// The progress of the curve at time t (0 to 1), as CSS computes a cubic-bezier: x is solved for t
// by Newton's method, with bisection when the slope is too flat.
export function bezierAt(b: Bezier, t: number): number {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const [x1, y1, x2, y2] = b;
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;
    const x = (s: number) => ((ax * s + bx) * s + cx) * s;
    const dx = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
    let s = t;
    for (let i = 0; i < 8; i++) {
        const err = x(s) - t;
        if (Math.abs(err) < 1e-7) break;
        const d = dx(s);
        if (Math.abs(d) < 1e-6) break;
        s -= err / d;
    }
    if (Math.abs(x(s) - t) >= 1e-7) {
        let lo = 0;
        let hi = 1;
        s = t;
        for (let i = 0; i < 40; i++) {
            if (x(s) < t) lo = s;
            else hi = s;
            s = (lo + hi) / 2;
        }
    }
    return ((ay * s + by) * s + cy) * s;
}
