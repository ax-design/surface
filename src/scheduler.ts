// One requestAnimationFrame loop for every surface on the page. Each frame runs three phases
// over the clients that asked for it: read (style, layout), compute (pure math), write (DOM).
// Clients never read layout after another client wrote, so a frame forces at most one layout.
//
// Quality runs at full by default. It degrades only when frames are measured to be late, with
// hysteresis, and the highest-priority clients (pressed, under the pointer) degrade last.

export interface FrameClient {
    read(now: number): void;
    compute(now: number): void;
    write(now: number, quality: Quality): void;
    // Larger is more important.
    priority(): number;
}

// 0 = full, 1 = reduced detail, 2 = every other frame, 3 = frozen.
export type Quality = 0 | 1 | 2 | 3;

export const PRIORITY_PRESSED = 3;
export const PRIORITY_POINTER = 2;
export const PRIORITY_ANIMATING = 1;
export const PRIORITY_IDLE = 0;

const SLOW_RATIO = 1.5;
const SLOW_FRAMES_TO_DEGRADE = 3;
const HEALTHY_FRAMES_TO_RECOVER = 30;
// Intervals outside this window come from suspended tabs or the first frame, not from load.
const MIN_INTERVAL = 4;
const MAX_INTERVAL = 150;

export class Scheduler {
    private pending: FrameClient[] = [];
    private queued = new Set<FrameClient>();
    private rafId = 0;
    private last = 0;
    private interval = 16.67;
    private slow = 0;
    private healthy = 0;
    private frame = 0;
    // Global degradation level, 0 to 3.
    level: Quality = 0;

    request(client: FrameClient): void {
        if (this.queued.has(client)) return;
        this.queued.add(client);
        this.pending.push(client);
        if (!this.rafId) this.rafId = requestAnimationFrame(this.run);
    }

    cancel(client: FrameClient): void {
        if (!this.queued.delete(client)) return;
        const i = this.pending.indexOf(client);
        if (i >= 0) this.pending.splice(i, 1);
    }

    private measure(now: number) {
        if (this.last) {
            const delta = now - this.last;
            if (delta > MIN_INTERVAL && delta < MAX_INTERVAL) {
                if (delta > this.interval * SLOW_RATIO) {
                    this.slow++;
                    this.healthy = 0;
                    if (this.slow >= SLOW_FRAMES_TO_DEGRADE && this.level < 3) {
                        this.level = (this.level + 1) as Quality;
                        this.slow = 0;
                    }
                } else {
                    // The reference interval only learns from healthy frames.
                    this.interval = this.interval * 0.9 + delta * 0.1;
                    this.slow = 0;
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

    // Clients above the top priority keep full quality until the global level reaches 3.
    private qualityFor(client: FrameClient): Quality {
        if (this.level === 0) return 0;
        if (client.priority() >= PRIORITY_POINTER) return this.level === 3 ? 1 : 0;
        return this.level;
    }

    private run = (now: number) => {
        this.rafId = 0;
        this.frame++;
        this.measure(now);
        const clients = this.pending;
        this.pending = [];
        this.queued.clear();

        const active: FrameClient[] = [];
        const qualities: Quality[] = [];
        for (const client of clients) {
            const quality = this.qualityFor(client);
            // Level 2 skips every other frame; level 3 freezes. Skipped clients stay queued.
            if ((quality === 2 && this.frame % 2 === 1) || quality === 3) {
                this.request(client);
                continue;
            }
            active.push(client);
            qualities.push(quality);
        }
        for (const c of active) safely(() => c.read(now));
        for (const c of active) safely(() => c.compute(now));
        for (let i = 0; i < active.length; i++) safely(() => active[i].write(now, qualities[i]));

        if (this.pending.length && !this.rafId) this.rafId = requestAnimationFrame(this.run);
        else if (!this.pending.length) this.last = 0;
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
