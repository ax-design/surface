// Self-measuring bench page. Query: ?impl=legacy&scenario=mount|sweep|toggle&n=200&mode=strictEdge
// The result lands in window.__result so any driver (Playwright, safaridriver) can collect it.
import type { BenchImpl, BenchResult, BorderDetectionMode, FrameStats } from './types.ts';
import { legacy } from './impl-legacy.ts';
import { probe, stats as probeStats } from './impl-probe.ts';
import { surface } from './impl-surface.ts';

const IMPLS: Record<string, BenchImpl> = { legacy, probe, surface };

// Work counter: every rAF callback the implementation schedules is timed. The harness itself
// uses the unwrapped rAF so its own bookkeeping is not counted.
const rawRaf = window.requestAnimationFrame.bind(window);
let work = 0;
window.requestAnimationFrame = (callback: FrameRequestCallback) =>
    rawRaf((timestamp) => {
        const start = performance.now();
        try {
            callback(timestamp);
        } finally {
            work += performance.now() - start;
        }
    });

const nextFrame = () => new Promise<number>((resolve) => rawRaf(resolve));

async function settle(frames: number) {
    for (let i = 0; i < frames; i++) await nextFrame();
}

function percentile(sorted: number[], p: number) {
    if (sorted.length === 0) return 0;
    const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
    return sorted[index];
}

function round(x: number) {
    return Math.round(x * 1000) / 1000;
}

function frameStats(works: number[], intervals: number[]): FrameStats {
    const w = works.slice().sort((a, b) => a - b);
    const iv = intervals.slice().sort((a, b) => a - b);
    const median = percentile(iv, 0.5);
    return {
        frames: works.length,
        workP50: round(percentile(w, 0.5)),
        workP95: round(percentile(w, 0.95)),
        workMax: round(w[w.length - 1] ?? 0),
        workTotal: round(works.reduce((a, b) => a + b, 0)),
        intervalP50: round(median),
        intervalP95: round(percentile(iv, 0.95)),
        slowFrames: intervals.filter((x) => x > median * 1.5).length,
    };
}

function dispatchPointer(type: string, x: number, y: number, mode: BorderDetectionMode, impl: BenchImpl, root: HTMLElement) {
    const target = mode === 'strictEdge' ? impl.pointerTarget(root) : document.elementFromPoint(x, y) || document.body;
    const event = new PointerEvent(type, {
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        bubbles: type !== 'pointerenter' && type !== 'pointerleave',
    });
    const start = performance.now();
    target.dispatchEvent(event);
    work += performance.now() - start;
}

// Serpentine path over the visible viewport.
function pathPoint(frame: number, total: number) {
    const rows = 4;
    const perRow = Math.max(1, Math.floor(total / rows));
    const row = Math.min(rows - 1, Math.floor(frame / perRow));
    const t = (frame % perRow) / perRow;
    const width = window.innerWidth - 40;
    const x = 20 + (row % 2 === 0 ? t : 1 - t) * width;
    const y = 30 + row * ((window.innerHeight - 60) / (rows - 1));
    return { x, y };
}

async function run(): Promise<BenchResult> {
    const q = new URLSearchParams(location.search);
    const implName = q.get('impl') || 'legacy';
    const scenario = q.get('scenario') || 'sweep';
    const count = Number(q.get('n') || 200);
    const mode = (q.get('mode') || 'experimentalAutoFit') as BorderDetectionMode;
    const impl = IMPLS[implName];
    const root = document.getElementById('root')!;
    const result: BenchResult = { impl: implName, scenario, mode, count, userAgent: navigator.userAgent, isolated: window.crossOriginIsolated === true };

    impl.setup(mode);
    await settle(2);

    // With ?sync=1 the driver snapshots engine metrics right before the measured phase.
    const syncPoint = async () => {
        if (q.get('sync') !== '1') return;
        window.__mounted = true;
        while (!window.__go) await nextFrame();
    };
    if (scenario === 'mount') await syncPoint();

    const mountStart = performance.now();
    await impl.mount(root, count);
    await settle(2);
    result.mountMs = round(performance.now() - mountStart);
    if (scenario === 'mount') return result;

    await settle(10);

    await syncPoint();

    if (scenario === 'sweep') {
        const total = 240;
        const works: number[] = [];
        const intervals: number[] = [];
        let { x, y } = pathPoint(0, total);
        dispatchPointer('pointerenter', x, y, mode, impl, root);
        dispatchPointer('pointermove', x, y, mode, impl, root);
        await nextFrame();
        work = 0;
        let last = await nextFrame();
        for (let frame = 1; frame <= total; frame++) {
            ({ x, y } = pathPoint(frame, total));
            const before = work;
            dispatchPointer('pointermove', x, y, mode, impl, root);
            // Register the harness frame after the dispatch so the implementation's paint for
            // this move runs first in the next frame and lands in this sample.
            const now = await nextFrame();
            works.push(work - before);
            intervals.push(now - last);
            last = now;
        }
        result.sweep = frameStats(works, intervals);
        return result;
    }

    if (scenario === 'toggle') {
        const cx = window.innerWidth / 2;
        const cy = 60;
        dispatchPointer('pointerenter', cx, cy, mode, impl, root);
        const baseline: number[] = [];
        const toggled: number[] = [];
        const flushes: number[] = [];
        for (let i = 0; i < 20; i++) {
            const toggle = i % 2 === 1;
            if (toggle) {
                root.classList.toggle('alt');
                // Synchronous style and layout flush: the engine cost of the change itself,
                // measurable in every browser (Safari has no CDP metrics).
                const flushStart = performance.now();
                void document.body.offsetWidth;
                flushes.push(performance.now() - flushStart);
                impl.afterToggle?.();
            }
            let sum = 0;
            for (let f = 0; f < 3; f++) {
                const before = work;
                // Keep the pointer moving by a pixel so the implementation keeps painting.
                dispatchPointer('pointermove', cx + ((i * 3 + f) % 2), cy, mode, impl, root);
                await nextFrame();
                sum += work - before;
            }
            (toggle ? toggled : baseline).push(sum);
        }
        const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
        result.toggleWorkMs = round(mean(toggled) - mean(baseline));
        result.toggleFlushMs = round(mean(flushes));
        return result;
    }

    throw new Error(`Unknown scenario ${scenario}`);
}

declare global {
    interface Window {
        __result?: BenchResult;
        __mounted?: boolean;
        __go?: boolean;
    }
}

run()
    .then((result) => {
        if (result.impl === 'probe') result.probe = { ...probeStats, readMs: round(probeStats.readMs) };
        window.__result = result;
    })
    .catch((error) => {
        window.__result = { impl: '', scenario: '', mode: 'strictEdge', count: 0, userAgent: navigator.userAgent, error: String(error && error.stack || error) };
    });
