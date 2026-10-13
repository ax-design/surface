import { Scheduler } from './scheduler.js';
import { StyleTriggers } from './triggers.js';

// Page-wide services. Several copies or versions of this package can be loaded into one page
// (bundled twice, micro frontends), so the services live under a versioned global symbol and
// the first copy creates them.

export interface PointerState {
    x: number;
    y: number;
    // False until the first pointer event, and after the pointer leaves the window.
    present: boolean;
    pressed: boolean;
    pointerType: string;
}

export interface PointerListener {
    onPointer(state: PointerState, type: string, event: PointerEvent): void;
}

export interface Services {
    version: 1;
    scheduler: Scheduler;
    triggers: StyleTriggers;
    pointer: PointerState;
    pointerListeners: Set<PointerListener>;
    observeVisibility(element: Element, callback: (visible: boolean) => void): void;
    unobserveVisibility(element: Element): void;
    observeSize(element: Element, callback: (width: number, height: number) => void): void;
    unobserveSize(element: Element): void;
}

const KEY = typeof Symbol === 'function' && Symbol.for ? Symbol.for('@ax-design/surface.v1') : '@ax-design/surface.v1';

function root(): Record<string | symbol, unknown> {
    return (typeof globalThis !== 'undefined' ? globalThis : window) as unknown as Record<string | symbol, unknown>;
}

const warned = new Set<string>();
function warnOnce(api: string, consequence: string) {
    if (warned.has(api)) return;
    warned.add(api);
    // eslint-disable-next-line no-console
    console.warn(`@ax-design/surface: ${api} is not available, ${consequence}. Load a polyfill if this browser must be supported fully.`);
}

function createServices(): Services {
    const pointer: PointerState = { x: 0, y: 0, present: false, pressed: false, pointerType: 'mouse' };
    const pointerListeners = new Set<PointerListener>();

    if (typeof PointerEvent !== 'undefined') {
        const update = (type: string) => (event: PointerEvent) => {
            pointer.x = event.clientX;
            pointer.y = event.clientY;
            pointer.pointerType = event.pointerType;
            if (type === 'pointerdown') pointer.pressed = true;
            if (type === 'pointerup' || type === 'pointercancel') pointer.pressed = false;
            pointer.present = !(type === 'pointercancel' || (type === 'pointerup' && event.pointerType !== 'mouse'));
            pointerListeners.forEach((l) => l.onPointer(pointer, type, event));
        };
        for (const type of ['pointermove', 'pointerdown', 'pointerup', 'pointercancel']) {
            window.addEventListener(type, update(type) as EventListener, { passive: true, capture: true });
        }
        document.documentElement.addEventListener('pointerleave', (event) => {
            if ((event as PointerEvent).pointerType !== 'mouse') return;
            pointer.present = false;
            pointer.pressed = false;
            pointerListeners.forEach((l) => l.onPointer(pointer, 'pointerleave', event as PointerEvent));
        });
    } else {
        warnOnce('PointerEvent', 'pointer effects are disabled');
    }

    const visibility = new Map<Element, (visible: boolean) => void>();
    let intersection: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
        intersection = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                const callback = visibility.get(entry.target);
                if (callback) callback(entry.isIntersecting);
            }
        });
    } else {
        warnOnce('IntersectionObserver', 'every surface is treated as visible');
    }

    const sizes = new Map<Element, (width: number, height: number) => void>();
    let resize: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
        resize = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const callback = sizes.get(entry.target);
                if (!callback) continue;
                // borderBoxSize is Safari 15.4+; contentRect covers older engines. Surfaces have
                // no padding or border of their own, so both give the same box.
                const box = entry.borderBoxSize && entry.borderBoxSize[0];
                if (box) callback(box.inlineSize, box.blockSize);
                else callback(entry.contentRect.width, entry.contentRect.height);
            }
        });
    } else {
        warnOnce('ResizeObserver', 'surfaces measure their size once when connected');
    }

    return {
        version: 1,
        scheduler: new Scheduler(),
        triggers: new StyleTriggers(),
        pointer,
        pointerListeners,
        observeVisibility(element, callback) {
            visibility.set(element, callback);
            if (intersection) intersection.observe(element);
            else callback(true);
        },
        unobserveVisibility(element) {
            visibility.delete(element);
            if (intersection) intersection.unobserve(element);
        },
        observeSize(element, callback) {
            sizes.set(element, callback);
            if (resize) resize.observe(element);
            else {
                const rect = element.getBoundingClientRect();
                callback(rect.width, rect.height);
            }
        },
        unobserveSize(element) {
            sizes.delete(element);
            if (resize) resize.unobserve(element);
        },
    };
}

export function services(): Services {
    const r = root();
    let s = r[KEY as string] as Services | undefined;
    if (!s) {
        s = createServices();
        r[KEY as string] = s;
    }
    return s;
}
