import { Scheduler } from './scheduler.js';
import { StyleTriggers } from './triggers.js';
import { VisibilityTracker } from './visibility.js';

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
    // The browser took over a touch for scrolling (pointercancel). The finger is followed with
    // touch events until it leaves the screen; between those throttled events the local
    // pointer of each surface stays put, so the highlight stays anchored to the content.
    touchScrolling: boolean;
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
    const pointer: PointerState = { x: 0, y: 0, present: false, pressed: false, pointerType: 'mouse', touchScrolling: false };
    const pointerListeners = new Set<PointerListener>();

    if (typeof PointerEvent !== 'undefined') {
        const notify = (type: string, event: Event) => pointerListeners.forEach((l) => l.onPointer(pointer, type, event as PointerEvent));
        const update = (type: string) => (event: PointerEvent) => {
            pointer.x = event.clientX;
            pointer.y = event.clientY;
            pointer.pointerType = event.pointerType;
            if (type === 'pointerdown') {
                pointer.pressed = true;
                pointer.touchScrolling = false;
            }
            if (type === 'pointerup' || type === 'pointercancel') pointer.pressed = false;
            if (type === 'pointercancel' && event.pointerType === 'touch') {
                pointer.touchScrolling = true;
                pointer.present = true;
            } else {
                pointer.present = !(type === 'pointercancel' || (type === 'pointerup' && event.pointerType !== 'mouse'));
            }
            notify(type, event);
        };
        for (const type of ['pointermove', 'pointerdown', 'pointerup', 'pointercancel']) {
            window.addEventListener(type, update(type) as EventListener, { passive: true, capture: true });
        }
        document.documentElement.addEventListener('pointerleave', (event) => {
            if ((event as PointerEvent).pointerType !== 'mouse') return;
            pointer.present = false;
            pointer.pressed = false;
            notify('pointerleave', event);
        });
        // While the browser scrolls under a finger, pointer events stop but touch events go on.
        window.addEventListener(
            'touchmove',
            (event) => {
                if (!pointer.touchScrolling || !event.touches.length) return;
                pointer.x = event.touches[0].clientX;
                pointer.y = event.touches[0].clientY;
                notify('touchmove', event);
            },
            { passive: true, capture: true }
        );
        const touchEnd = (event: TouchEvent) => {
            if (!pointer.touchScrolling || event.touches.length) return;
            pointer.touchScrolling = false;
            pointer.present = false;
            notify('pointerleave', event);
        };
        window.addEventListener('touchend', touchEnd, { passive: true, capture: true });
        window.addEventListener('touchcancel', touchEnd, { passive: true, capture: true });
    } else {
        warnOnce('PointerEvent', 'pointer effects are disabled');
    }

    const visibility = new VisibilityTracker();
    if (!visibility.available) warnOnce('IntersectionObserver', 'every surface is treated as visible');

    const sizes = new Map<Element, (width: number, height: number) => void>();
    let resize: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
        resize = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const callback = sizes.get(entry.target);
                if (!callback) continue;
                // borderBoxSize is Safari 15.4+; contentRect covers older engines. Surfaces have
                // no padding or border of their own, so both give the same box.
                // A size change can be a display toggle: re-check visibility.
                visibility.requestRound();
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
            visibility.observe(element, callback);
        },
        unobserveVisibility(element) {
            visibility.unobserve(element);
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
