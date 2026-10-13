// Bench driver.
// bun bench/run.ts --browser chromium|chrome|safari --impls legacy --scenarios sweep,toggle,mount
//   --modes experimentalAutoFit,strictEdge --n 200 --repeat 3 --throttle 1
import { resolve, join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : fallback;
};
const browserName = arg('browser', 'chromium');
const impls = arg('impls', 'legacy').split(',');
const variants = arg('variants', '').split(',');
const scenarios = arg('scenarios', 'sweep,toggle,mount').split(',');
const modes = arg('modes', 'experimentalAutoFit,strictEdge').split(',');
const counts = arg('n', '200').split(',').map(Number);
const repeat = Number(arg('repeat', '3'));
const throttle = Number(arg('throttle', '1'));
const dist = resolve(import.meta.dir, arg('dist', 'dist'));

const server = Bun.serve({
    port: 0,
    fetch(req) {
        const path = new URL(req.url).pathname;
        const file = Bun.file(join(dist, path === '/' ? 'page.html' : path));
        // Cross-origin isolation raises timer precision (Safari rounds to 1 ms otherwise).
        const headers = {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        };
        return file.size ? new Response(file, { headers }) : new Response('', { status: 404, headers });
    },
});
const origin = `http://127.0.0.1:${server.port}`;

interface Driver {
    run(url: string): Promise<Record<string, unknown>>;
    close(): Promise<void>;
}

async function playwrightDriver(): Promise<Driver> {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch(browserName === 'chrome' ? { channel: 'chrome', headless: false } : {});
    return {
        async run(url) {
            const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
            const cdp = await page.context().newCDPSession(page);
            if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
            await cdp.send('Performance.enable');
            await page.goto(url + '&sync=1');
            await page.waitForFunction(() => window.__mounted || window.__result, null, { timeout: 120000, polling: 50 });
            const metrics = async () => {
                const { metrics } = await cdp.send('Performance.getMetrics');
                return Object.fromEntries(metrics.map((m: { name: string; value: number }) => [m.name, m.value]));
            };
            const before = await metrics();
            await page.evaluate(() => { window.__go = true; });
            await page.waitForFunction(() => window.__result, null, { timeout: 120000, polling: 100 });
            const after = await metrics();
            const result = (await page.evaluate(() => window.__result)) as Record<string, unknown>;
            const ms = (k: string) => Math.round(((after[k] ?? 0) - (before[k] ?? 0)) * 100000) / 100;
            result.engine = {
                scriptMs: ms('ScriptDuration'),
                styleMs: ms('RecalcStyleDuration'),
                layoutMs: ms('LayoutDuration'),
                taskMs: ms('TaskDuration'),
                styleCount: (after.RecalcStyleCount ?? 0) - (before.RecalcStyleCount ?? 0),
                layoutCount: (after.LayoutCount ?? 0) - (before.LayoutCount ?? 0),
                heapMB: Math.round((after.JSHeapUsedSize ?? 0) / 1048576 * 10) / 10,
                nodes: after.Nodes,
            };
            await page.close();
            return result;
        },
        close: () => browser.close(),
    };
}

async function safariDriver(): Promise<Driver> {
    const port = 4450;
    const proc = Bun.spawn(['safaridriver', '-p', String(port)]);
    await Bun.sleep(1000);
    const call = async (method: string, path: string, body?: unknown) => {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
            method,
            headers: { 'content-type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
        });
        const json = (await res.json()) as { value: any };
        if (json.value && json.value.error) throw new Error(`${json.value.error}: ${json.value.message}`);
        return json.value;
    };
    const sid = (await call('POST', '/session', { capabilities: {} })).sessionId;
    await call('POST', `/session/${sid}/window/rect`, { width: 1280, height: 1000 });
    return {
        async run(url) {
            await call('POST', `/session/${sid}/url`, { url });
            for (;;) {
                const result = await call('POST', `/session/${sid}/execute/sync`, { script: 'return window.__result || null', args: [] });
                if (result) return result;
                await Bun.sleep(200);
            }
        },
        async close() {
            await call('DELETE', `/session/${sid}`);
            proc.kill();
        },
    };
}

const driver = browserName === 'safari' ? await safariDriver() : await playwrightDriver();
const rows: Record<string, unknown>[] = [];
for (const impl of impls)
  for (const variant of impl === 'probe' || impl === 'surface' ? variants : [''])
    for (const scenario of scenarios)
        for (const mode of modes)
            for (const n of counts)
                for (let r = 0; r < repeat; r++) {
                    const url = `${origin}/?impl=${impl}&scenario=${scenario}&mode=${mode}&n=${n}&variant=${variant}`;
                    const result = await driver.run(url);
                    rows.push({ browser: browserName, throttle, run: r, variant, ...result });
                    process.stderr.write('.');
                }
await driver.close();
server.stop();
process.stderr.write('\n');
console.log(JSON.stringify(rows));

declare global {
    interface Window {
        __result?: unknown;
        __mounted?: boolean;
        __go?: boolean;
    }
}
