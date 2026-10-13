// Builds and runs the surface browser test. Usage: bun test-browser/run.ts [chromium|firefox|webkit|safari ...]
import { join } from 'node:path';

const dir = import.meta.dir;
const dist = join(dir, 'dist');
if (!process.env.SKIP_BUILD) {
    const result = await Bun.build({ entrypoints: [join(dir, 'page.html')], outdir: dist });
    if (!result.success) throw new Error(result.logs.join('\n'));
}
const server = Bun.serve({
    port: 0,
    fetch(req) {
        const path = new URL(req.url).pathname;
        const file = Bun.file(join(dist, path === '/' ? 'page.html' : path));
        return file.size ? new Response(file) : new Response('', { status: 404 });
    },
});
const url = `http://127.0.0.1:${server.port}/`;

interface Driver {
    eval<T>(script: string): Promise<T>;
    move(x: number, y: number): Promise<void>;
    down(): Promise<void>;
    up(): Promise<void>;
    close(): Promise<void>;
}

async function playwright(name: string): Promise<Driver> {
    const pw = (await import('playwright')) as any;
    const browser = await pw[name].launch();
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(url);
    return {
        eval: (script) => page.evaluate(script),
        move: (x, y) => page.mouse.move(x, y),
        down: () => page.mouse.down(),
        up: () => page.mouse.up(),
        close: () => browser.close(),
    };
}

async function safari(): Promise<Driver> {
    const port = 4461;
    const proc = Bun.spawn(['safaridriver', '-p', String(port)]);
    await Bun.sleep(1000);
    const call = async (method: string, path: string, body?: unknown) => {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        const json = (await res.json()) as { value: any };
        if (json.value && json.value.error) throw new Error(json.value.message);
        return json.value;
    };
    const sid = (await call('POST', '/session', { capabilities: {} })).sessionId;
    await call('POST', `/session/${sid}/window/rect`, { width: 800, height: 700 });
    await call('POST', `/session/${sid}/url`, { url });
    const pointer = async (actions: unknown[]) =>
        call('POST', `/session/${sid}/actions`, { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions }] });
    return {
        eval: (script) => call('POST', `/session/${sid}/execute/sync`, { script: `return (${script})`, args: [] }),
        move: (x, y) => pointer([{ type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y), origin: 'viewport' }]),
        down: () => pointer([{ type: 'pointerDown', button: 0 }]),
        up: () => pointer([{ type: 'pointerUp', button: 0 }]),
        async close() {
            await call('DELETE', `/session/${sid}`);
            proc.kill();
        },
    };
}

async function drive(d: Driver) {
    for (;;) {
        const state = await d.eval<{ result: any; step: string; ack: string }>('({ result: window.__result || null, step: window.__step || "", ack: window.__ack || "" })');
        if (state.result) return state.result;
        if (state.step && state.step !== state.ack) {
            const rect = async (id: string) => d.eval<{ x: number; y: number; w: number; h: number }>(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
            if (state.step === 'hover-h') {
                const r = await rect('h');
                await d.move(r.x + r.w / 2, r.y + r.h / 2);
            } else if (state.step === 'leave') {
                await d.move(700, 550);
            } else if (state.step === 'press-t') {
                const r = await rect('t');
                const x = r.x + r.w - 12;
                const y = r.y + 10;
                await d.eval(`(window.__pointer = { x: ${x}, y: ${y} })`);
                await d.move(x, y);
                await d.down();
            } else if (state.step === 'release') {
                await d.up();
            }
            await d.eval(`(window.__ack = ${JSON.stringify(state.step)})`);
        }
        await Bun.sleep(50);
    }
}

let failed = 0;
for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['chromium']) {
    const d = name === 'safari' ? await safari() : await playwright(name);
    let result: any;
    try {
        result = await drive(d);
    } finally {
        await d.close();
    }
    if (result.error) {
        console.log(`${name}: ERROR ${result.error}`);
        failed++;
        continue;
    }
    const bad = result.checks.filter((c: any) => !c.ok);
    failed += bad.length;
    console.log(`${name}: ${result.checks.length - bad.length}/${result.checks.length} passed`);
    for (const c of bad) console.log(`  FAIL ${c.name}: ${c.detail}`);
}
server.stop();
process.exit(failed ? 1 : 0);
