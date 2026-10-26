import { afterEach, beforeEach, expect, test } from 'bun:test';
import { VisibilityTracker } from '../src/visibility';

// An IntersectionObserver by hand: observe() queues the target, report() answers for the queued ones.
type Entry = { target: Element; isIntersecting: boolean };
let observers: FakeObserver[] = [];

class FakeObserver {
    observed = new Set<Element>();
    constructor(readonly callback: (entries: Entry[]) => void) {
        observers.push(this);
    }
    observe(el: Element) {
        this.observed.add(el);
    }
    unobserve(el: Element) {
        this.observed.delete(el);
    }
    disconnect() {
        this.observed.clear();
    }
    report(visible: boolean) {
        this.callback([...this.observed].map((target) => ({ target, isIntersecting: visible })));
    }
}

const g = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};
const KEYS = ['IntersectionObserver', 'MutationObserver', 'document', 'window'];

beforeEach(() => {
    observers = [];
    for (const key of KEYS) saved[key] = g[key];
    g.IntersectionObserver = FakeObserver;
    g.MutationObserver = class {
        observe() {}
    };
    g.document = { addEventListener() {} };
    g.window = { addEventListener() {} };
});

afterEach(() => {
    for (const key of KEYS) g[key] = saved[key];
});

const element = (): Element => ({}) as Element;

test('surfaces that share an element are told together, and the page watches one target', () => {
    const tracker = new VisibilityTracker();
    const host = element();
    const seen: string[] = [];
    tracker.observe(host, (v) => seen.push(`a:${v}`));
    tracker.observe(host, (v) => seen.push(`b:${v}`));
    expect(observers[0].observed.size).toBe(1);
    observers[0].report(true);
    expect(seen.sort()).toEqual(['a:true', 'b:true']);
});

test('a surface that joins an element that has reported is told at once', () => {
    const tracker = new VisibilityTracker();
    const host = element();
    tracker.observe(host, () => {});
    observers[0].report(true);
    const seen: boolean[] = [];
    tracker.observe(host, (v) => seen.push(v));
    expect(seen).toEqual([true]);
});

test('unobserving one surface keeps the element for the others, and the last one drops it', () => {
    const tracker = new VisibilityTracker();
    const host = element();
    const seen: string[] = [];
    const a = (v: boolean) => seen.push(`a:${v}`);
    const b = (v: boolean) => seen.push(`b:${v}`);
    tracker.observe(host, a);
    tracker.observe(host, b);
    observers[0].report(true);
    seen.length = 0;
    tracker.unobserve(host, a);
    tracker.requestRound();
    observers[0].report(false);
    expect(seen).toEqual(['b:false']);
    tracker.unobserve(host, b);
    tracker.requestRound();
    expect(observers[0].observed.size).toBe(0);
});
