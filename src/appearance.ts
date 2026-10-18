// The user's display preferences that change how layers draw, read once for the page. The
// defaults follow WinUI: the effects fall back to solid colors when transparency is turned off
// or when the page asks for it (Windows also does so for battery saver and slow hardware, which a
// page cannot detect), High Contrast swaps every effect for system colors, and turning off
// animations skips transitions to their end. Reveal light is not an animation and stays.
export interface Appearance {
    // Windows High Contrast and other forced palettes: (forced-colors: active). Layers then draw
    // with CSS system colors (Canvas, CanvasText, Highlight...), or not at all.
    forcedColors: boolean;
    // (prefers-reduced-transparency: reduce), the "Transparency effects" switch.
    reducedTransparency: boolean;
    // (prefers-reduced-motion: reduce), the "Show animations" switch. Transitions jump to
    // their end state; the state itself still changes.
    reducedMotion: boolean;
    // Set by the page with setAlwaysUseFallback(), like AlwaysUseFallback of WinUI brushes.
    alwaysUseFallback: boolean;
    // Bumped on every change. Surfaces compare it to tell layers through changed.appearance.
    version: number;
    // Called on every change: the visible surfaces, which then draw a frame.
    listeners: Set<() => void>;
}

const QUERIES: [keyof Appearance, string][] = [
    ['forcedColors', '(forced-colors: active)'],
    ['reducedTransparency', '(prefers-reduced-transparency: reduce)'],
    ['reducedMotion', '(prefers-reduced-motion: reduce)'],
];

// Shared by every copy of this package on the page, like the services.
const KEY = typeof Symbol === 'function' && Symbol.for ? Symbol.for('@ax-design/surface.appearance.v1') : '@ax-design/surface.appearance.v1';

function create(): Appearance {
    const state: Appearance = { forcedColors: false, reducedTransparency: false, reducedMotion: false, alwaysUseFallback: false, version: 0, listeners: new Set() };
    if (typeof matchMedia !== 'function') return state;
    for (const [field, query] of QUERIES) {
        const list = matchMedia(query);
        const sync = () => {
            if ((state[field] as boolean) === list.matches) return;
            (state as unknown as Record<string, boolean>)[field] = list.matches;
            changed(state);
        };
        (state as unknown as Record<string, boolean>)[field] = list.matches;
        // addEventListener on MediaQueryList is Safari 14+; addListener is older.
        if (list.addEventListener) list.addEventListener('change', sync);
        else if (list.addListener) list.addListener(sync);
    }
    return state;
}

// A preference that leaves every custom property as it was would not reach the layers through
// a style read, so the surfaces are woken up directly and see the new version.
function changed(state: Appearance) {
    state.version++;
    state.listeners.forEach((listener) => listener());
}

// The live, shared state. Layers read it from their frame (frame.appearance); other code reads
// it here.
export function appearance(): Appearance {
    const r = (typeof globalThis !== 'undefined' ? globalThis : window) as unknown as Record<string, Appearance | undefined>;
    return r[KEY as string] || (r[KEY as string] = create());
}

// Draws every effect with its fallback, as when transparency effects are off. For pages that
// know better than the browser: battery saver, slow devices, a user setting of their own.
export function setAlwaysUseFallback(value: boolean): void {
    const state = appearance();
    if (state.alwaysUseFallback === value) return;
    state.alwaysUseFallback = value;
    changed(state);
}

// Whether effects with a solid fallback (acrylic, reveal) should use it.
export function useFallback(a: Appearance): boolean {
    return a.forcedColors || a.reducedTransparency || a.alwaysUseFallback;
}
