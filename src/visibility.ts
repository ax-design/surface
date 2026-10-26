// Viewport visibility of surfaces, without paying IntersectionObserver every frame.
//
// An IntersectionObserver with many targets recomputes all of them on every rendering update.
// With 1000 surfaces and a reveal sweep repainting canvases each frame, that cost about as much
// as the whole reveal layer. Visibility only changes after scrolling, resizing, DOM or style
// mutations, size changes (display toggles) and animations, so the observer is attached for one
// round after such activity and detached once every target has reported. Movements no event
// reports (a layout shift caused by :hover or :focus) follow pointer, focus or key activity, so
// one more round runs when such activity pauses. An idle page runs no rounds at all.

const SETTLE_DELAY = 300;
// A surface counts as visible this far outside the viewport, so that its layers are made before it
// comes in: a tile that slides or shrinks into view during an animation would otherwise build its
// layers (and acrylic its noise) in the middle of the animation, and drop frames there.
const MARGIN = '256px';

export class VisibilityTracker {
    // Several surfaces may share one element (see AxSurface.visibilityTarget).
    private callbacks = new Map<Element, Set<(visible: boolean) => void>>();
    // What each element reported last, for a surface that joins an element that has reported.
    private last = new Map<Element, boolean>();
    private observer: IntersectionObserver | null = null;
    // Targets of the running round that have not reported yet.
    private awaiting = new Set<Element>();
    private active = false;
    // Activity seen during a round: run another one when it ends.
    private again = false;
    private started = false;

    constructor() {
        if (typeof IntersectionObserver === 'undefined') return;
        this.observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                const callbacks = this.callbacks.get(entry.target);
                if (callbacks) {
                    this.last.set(entry.target, entry.isIntersecting);
                    callbacks.forEach((callback) => callback(entry.isIntersecting));
                }
                this.awaiting.delete(entry.target);
            }
            if (this.active && this.awaiting.size === 0) this.finishRound();
        }, { rootMargin: MARGIN });
    }

    get available(): boolean {
        return this.observer !== null;
    }

    observe(element: Element, callback: (visible: boolean) => void): void {
        let callbacks = this.callbacks.get(element);
        const joined = !!callbacks && callbacks.size > 0;
        if (!callbacks) this.callbacks.set(element, (callbacks = new Set()));
        callbacks.add(callback);
        if (!this.observer) {
            callback(true);
            return;
        }
        if (!this.started) this.start();
        // The element has reported already: the surface that joins it is told at once.
        const known = this.last.get(element);
        if (joined && known !== undefined) {
            callback(known);
            return;
        }
        if (this.active) {
            this.awaiting.add(element);
            this.observer.observe(element);
        } else {
            this.requestRound();
        }
    }

    unobserve(element: Element, callback?: (visible: boolean) => void): void {
        const callbacks = this.callbacks.get(element);
        if (callbacks && callback) callbacks.delete(callback);
        // The element goes with its last surface.
        if (callbacks && callback && callbacks.size > 0) return;
        this.callbacks.delete(element);
        this.last.delete(element);
        if (!this.observer) return;
        this.observer.unobserve(element);
        if (this.awaiting.delete(element) && this.active && this.awaiting.size === 0) this.finishRound();
    }

    requestRound = (): void => {
        if (!this.observer || this.callbacks.size === 0) return;
        if (this.active) {
            this.again = true;
            return;
        }
        this.active = true;
        this.again = false;
        const observer = this.observer;
        this.callbacks.forEach((_, element) => {
            this.awaiting.add(element);
            // Observing reports the current state in the next rendering update.
            observer.observe(element);
        });
    };

    private finishRound() {
        this.active = false;
        if (this.observer) this.observer.disconnect();
        if (this.again) this.requestRound();
    }

    private start() {
        this.started = true;
        const capture = { capture: true, passive: true } as AddEventListenerOptions;
        document.addEventListener('scroll', this.requestRound, capture);
        window.addEventListener('resize', this.requestRound, { passive: true });
        for (const type of ['transitionend', 'animationend', 'animationcancel', 'transitioncancel']) document.addEventListener(type, this.requestRound, true);
        if (typeof MutationObserver !== 'undefined') {
            new MutationObserver(this.requestRound).observe(document, { attributes: true, childList: true, subtree: true });
        }
        let settle: ReturnType<typeof setTimeout> | number = 0;
        const onActivity = () => {
            if (settle) clearTimeout(settle as number);
            settle = setTimeout(() => {
                settle = 0;
                this.requestRound();
            }, SETTLE_DELAY);
        };
        for (const type of ['pointerover', 'pointerout', 'pointerup', 'focusin', 'focusout', 'keyup']) window.addEventListener(type, onActivity, capture);
    }
}
