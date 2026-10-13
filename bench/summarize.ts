// Prints median results per configuration as markdown tables.
// Usage: bun bench/summarize.ts bench/results/*.json
const files = process.argv.slice(2);
type Row = Record<string, any>;
const rows: Row[] = [];
for (const file of files) {
    const text = await Bun.file(file).text();
    if (!text.trim()) continue;
    rows.push(...JSON.parse(text));
}

const median = (xs: number[]) => {
    const s = xs.filter((x) => typeof x === 'number' && !Number.isNaN(x)).sort((a, b) => a - b);
    if (!s.length) return NaN;
    return s[Math.floor((s.length - 1) / 2)];
};
const fmt = (x: number) => (Number.isNaN(x) ? '-' : x.toFixed(2));

const groups = new Map<string, Row[]>();
for (const r of rows) {
    const label = r.variant ? `${r.impl}/${r.variant}` : r.impl;
    const key = [r.browser, `x${r.throttle}`, r.scenario, label, r.scenario === 'sweep' || r.impl !== 'probe' ? r.mode : '-', r.count].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
}

const errors = rows.filter((r) => r.error);
if (errors.length) console.log(`errors: ${errors.length}\n${errors.map((r) => r.error).join('\n')}\n`);

for (const scenario of ['sweep', 'toggle', 'mount']) {
    const keys = [...groups.keys()].filter((k) => k.split('|')[2] === scenario).sort();
    if (!keys.length) continue;
    console.log(`\n### ${scenario}\n`);
    if (scenario === 'sweep') {
        console.log('| browser | cpu | impl | mode | n | work p50 | work p95 | work max | slow frames | script | style | layout |');
        console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
    } else if (scenario === 'toggle') {
        console.log('| browser | cpu | impl | mode | n | flush per toggle | extra JS per toggle | script | style | layout |');
        console.log('|---|---|---|---|---|---|---|---|---|---|');
    } else {
        console.log('| browser | cpu | impl | mode | n | mount wall | script | style | layout | nodes |');
        console.log('|---|---|---|---|---|---|---|---|---|---|');
    }
    for (const key of keys) {
        const g = groups.get(key)!;
        const [browser, cpu, , impl, mode, n] = key.split('|');
        const e = (k: string) => fmt(median(g.map((r) => r.engine?.[k])));
        const head = `| ${browser} | ${cpu} | ${impl} | ${mode} | ${n} |`;
        if (scenario === 'sweep') {
            const s = (k: string) => fmt(median(g.map((r) => r.sweep?.[k])));
            console.log(`${head} ${s('workP50')} | ${s('workP95')} | ${s('workMax')} | ${s('slowFrames')} | ${e('scriptMs')} | ${e('styleMs')} | ${e('layoutMs')} |`);
        } else if (scenario === 'toggle') {
            console.log(`${head} ${fmt(median(g.map((r) => r.toggleFlushMs)))} | ${fmt(median(g.map((r) => r.toggleWorkMs)))} | ${e('scriptMs')} | ${e('styleMs')} | ${e('layoutMs')} |`);
        } else {
            console.log(`${head} ${fmt(median(g.map((r) => r.mountMs)))} | ${e('scriptMs')} | ${e('styleMs')} | ${e('layoutMs')} | ${e('nodes')} |`);
        }
    }
}
