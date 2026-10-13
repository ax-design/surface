// One requestAnimationFrame loop for every surface on the page. Each frame runs three phases
// over the clients that asked for it: read (style, layout), compute (pure math), write (DOM).
// Clients never read layout after another client wrote, so a frame forces at most one layout.
//
// Full speed by default: every requesting client runs every frame. Only when late frames are
// measured (with hysteresis) does the scheduler start a frame budget: clients run in priority
// order (pressed, under the pointer, then near and large ones first) until their estimated
// cost fills the budget, and the rest wait for a later frame. A waiting client gains priority
// with every frame it waits, so lower frame rates never turn into starvation (the aging rule
// of the tiqian CoordinationService).

export interface FrameClient {
    read(now: number): void;
    compute(now: number): void;
    write(now: number, quality: Quality): void;
    // Larger is more important. See the PRIORITY_* constants.
    priority(): number;
}

// 0 = full speed, 1 to 3 = increasing load measured. Layers may reduce detail at higher levels.
export type Quality = 0 | 1 | 2 | 3;

// Always run, even over budget.
export const PRIORITY_PRESSED = 1e12;
export const PRIORITY_POINTER = 1e11;
// Below PRIORITY_POINTER, priorities are free-form scores (area over squared distance).
export const PRIORITY_IDLE = 0;

const SLOW_RATIO = 1.5;
// Degrade when this many of the last WINDOW measured frames were slow.
const WINDOW = 10;
const SLOW_IN_WINDOW = 4;
const HEALTHY_FRAMES_TO_RECOVER = 30;
// Empty frames kept after the last work, so interactive periods measure back-to-back frames.
// Without them, work driven by pointer events never sees two consecutive frames.
const TAIL_FRAMES = 3;
// Intervals outside this window come from suspended tabs or the first frame, not from load.
const MIN_INTERVAL = 4;
const MAX_INTERVAL = 150;
// Share of the frame interval the JS budget may use, per level.
const BUDGET_SHARE = [1, 0.4, 0.25, 0.15];
// Share of the lower-priority clients that may update per frame, per level. Most of the cost
// of a reveal update is not JS but canvas raster and compositing in the browser, which the JS
// budget cannot see; limiting how many surfaces update lowers their frame rate instead.
const CLIENT_SHARE = [1, 0.5, 0.25, 0.1];
const MIN_BUDGET = 1.5;
// Cost guess for a client never measured, ms.
const DEFAULT_COST = 0.2;
// Each waited frame adds this much to log10(priority).
const AGING_STEP = 0.75;

interface Entry {
    cost: number;
    deferred: number;
}

export class Scheduler {
    private pending: FrameClient[] = [];
    private queued = new Set<FrameClient>();
    private entries = new Map<FrameClient, Entry>();
    private rafId = 0;
    private last = 0;
    private interval = 16.67;
    private recent: boolean[] = [];
    private healthy = 0;
    private tail = 0;
    // True when the pending frame was requested by the previous frame itself.
    private chained = false;
    // Global load level, 0 to 3.
    level: Quality = 0;
    // For tests and diagnostics: clients deferred in the last frame.
    lastDeferred = 0;
    // Diagnostics switch: false keeps full speed whatever the load.
    adaptive = true;

    request(client: FrameClient): void {
        if (this.queued.has(client)) return;
        this.queued.add(client);
        this.pending.push(client);
        if (!this.rafId) {
            this.rafId = requestAnimationFrame(this.run);
            this.chained = false;
        }
    }

    cancel(client: FrameClient): void {
        this.entries.delete(client);
        if (!this.queued.delete(client)) return;
        const i = this.pending.indexOf(client);
        if (i >= 0) this.pending.splice(i, 1);
    }

    private entry(client: FrameClient): Entry {
        let e = this.entries.get(client);
        if (!e) {
            e = { cost: DEFAULT_COST, deferred: 0 };
            this.entries.set(client, e);
        }
        return e;
    }

    private measure(now: number) {
        if (this.chained && this.last) {
            const delta = now - this.last;
            if (delta > MIN_INTERVAL && delta < MAX_INTERVAL) {
                const slow = delta > this.interval * SLOW_RATIO;
                this.recent.push(slow);
                if (this.recent.length > WINDOW) this.recent.shift();
                if (slow) {
                    this.healthy = 0;
                    const count = this.recent.filter(Boolean).length;
                    if (this.adaptive && count >= SLOW_IN_WINDOW && this.level < 3) {
                        this.level = (this.level + 1) as Quality;
                        this.recent = [];
                    }
                } else {
                    // The reference interval only learns from healthy frames.
                    this.interval = this.interval * 0.9 + delta * 0.1;
                    this.healthy++;
                    if (this.healthy >= HEALTHY_FRAMES_TO_RECOVER && this.level > 0) {
                        this.level = (this.level - 1) as Quality;
                        this.healthy = 0;
                    }
                }
            }
        }
        this.last = now;
    }

    // Picks the clients of this frame. Returns them in priority order.
    private select(clients: FrameClient[]): FrameClient[] {
        if (this.level === 0) {
            for (const c of clients) this.entry(c).deferred = 0;
            this.lastDeferred = 0;
            return clients;
        }
        const scored = clients.map((c) => {
            const p = c.priority();
            const e = this.entry(c);
            return { c, p, e, score: Math.log(1 + Math.max(0, p)) / Math.LN10 + e.deferred * AGING_STEP };
        });
        scored.sort((a, b) => b.score - a.score);
        const budget = Math.max(MIN_BUDGET, this.interval * BUDGET_SHARE[this.level]);
        const others = scored.filter((s) => s.p < PRIORITY_POINTER).length;
        let slots = Math.ceil(others * CLIENT_SHARE[this.level]);
        let spent = 0;
        const chosen: FrameClient[] = [];
        let deferred = 0;
        for (const s of scored) {
            const top = s.p >= PRIORITY_POINTER;
            if (top || (slots > 0 && spent + s.e.cost <= budget) || chosen.length === 0) {
                if (!top) slots--;
                chosen.push(s.c);
                spent += s.e.cost;
                s.e.deferred = 0;
            } else {
                s.e.deferred++;
                deferred++;
                this.request(s.c);
            }
        }
        this.lastDeferred = deferred;
        return chosen;
    }

    private run = (now: number) => {
        this.rafId = 0;
        this.measure(now);
        this.chained = false;
        const clients = this.pending;
        this.pending = [];
        this.queued.clear();

        const active = this.select(clients);
        const costs = new Array<number>(active.length).fill(0);
        const timed = (i: number, f: () => void) => {
            const t = performance.now();
            safely(f);
            costs[i] += performance.now() - t;
        };
        for (let i = 0; i < active.length; i++) timed(i, () => active[i].read(now));
        for (let i = 0; i < active.length; i++) timed(i, () => active[i].compute(now));
        for (let i = 0; i < active.length; i++) timed(i, () => active[i].write(now, this.level));
        for (let i = 0; i < active.length; i++) {
            const e = this.entry(active[i]);
            e.cost = e.cost * 0.7 + costs[i] * 0.3;
        }

        if (active.length) this.tail = TAIL_FRAMES;
        else if (this.tail > 0) this.tail--;
        if ((this.pending.length || this.tail > 0) && !this.rafId) {
            this.rafId = requestAnimationFrame(this.run);
            this.chained = true;
        }
    };
}

function safely(f: () => void) {
    try {
        f();
    } catch (error) {
        // One broken client must not stop every other surface.
        setTimeout(() => {
            throw error;
        });
    }
}
