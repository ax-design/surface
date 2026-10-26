import { afterEach, beforeEach, expect, test } from 'bun:test';
import { PRIORITY_IDLE, PRIORITY_POINTER, PRIORITY_PRESSED, Scheduler } from '../src/index';
import type { FrameClient } from '../src/index';

// A frame loop by hand: requestAnimationFrame only queues, frame() runs what was queued.
let queue: ((time: number) => void)[] = [];
let time = 0;
const saved = (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;

beforeEach(() => {
    queue = [];
    time = 1000;
    (globalThis as unknown as { requestAnimationFrame: (cb: (t: number) => void) => number }).requestAnimationFrame = (cb) => {
        queue.push(cb);
        return queue.length;
    };
});

afterEach(() => {
    (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = saved;
});

function frame(): void {
    const run = queue;
    queue = [];
    time += 16.7;
    for (const cb of run) cb(time);
}

function client(log: string[], name: string, priority = PRIORITY_IDLE): FrameClient {
    return {
        read: () => void log.push(`${name}.read`),
        compute: () => void log.push(`${name}.compute`),
        write: () => void log.push(`${name}.write`),
        priority: () => priority,
    };
}

test('the priorities are exported for clients that are not surfaces', () => {
    expect(PRIORITY_PRESSED).toBeGreaterThan(PRIORITY_POINTER);
    expect(PRIORITY_POINTER).toBeGreaterThan(PRIORITY_IDLE);
});

test('every client reads before any client computes, and computes before any client writes', () => {
    const scheduler = new Scheduler();
    const log: string[] = [];
    scheduler.request(client(log, 'a'));
    scheduler.request(client(log, 'b'));
    expect(queue.length).toBe(1);
    frame();
    expect(log).toEqual(['a.read', 'b.read', 'a.compute', 'b.compute', 'a.write', 'b.write']);
});

test('a client that asks twice in a frame runs once', () => {
    const scheduler = new Scheduler();
    const log: string[] = [];
    const a = client(log, 'a');
    scheduler.request(a);
    scheduler.request(a);
    frame();
    expect(log.filter((l) => l === 'a.write').length).toBe(1);
});

test('a cancelled client does not run', () => {
    const scheduler = new Scheduler();
    const log: string[] = [];
    const a = client(log, 'a');
    scheduler.request(a);
    scheduler.cancel(a);
    frame();
    expect(log).toEqual([]);
});

test('a client that asks again from its write runs in the next frame, and one that does not is left alone', () => {
    const scheduler = new Scheduler();
    let runs = 0;
    const again: FrameClient = {
        read() {},
        compute() {},
        write() {
            runs++;
            if (runs < 3) scheduler.request(again);
        },
        priority: () => PRIORITY_IDLE,
    };
    scheduler.request(again);
    for (let i = 0; i < 10; i++) frame();
    expect(runs).toBe(3);
});

test('an idle scheduler asks for no frame: a few empty frames after the last work, then none', () => {
    const scheduler = new Scheduler();
    scheduler.request(client([], 'a'));
    let frames = 0;
    while (queue.length && frames < 50) {
        frame();
        frames++;
    }
    expect(queue.length).toBe(0);
    expect(frames).toBeLessThan(10);
});
