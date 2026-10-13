// Builds a demo page into demo/dist: bun demo/build.ts [index|compare]
// @ax-design/surface always resolves to this checkout's src, also inside the reveal and acrylic
// packages, so the page runs one copy: the code you are editing. The other packages come from
// sibling checkouts when they exist, else from node_modules.
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const sources: Record<string, string> = { '@ax-design/surface': resolve(import.meta.dir, '../src/index.ts') };
for (const name of ['shape', 'typed-om', 'reveal-highlight', 'acrylic']) {
    const path = join(root, name, 'src/index.ts');
    if (existsSync(path)) sources[`@ax-design/${name}`] = path;
}

export async function build(name = 'index'): Promise<void> {
    rmSync(join(import.meta.dir, 'dist'), { recursive: true, force: true });
    const result = await Bun.build({
        entrypoints: [join(import.meta.dir, `${name}.html`)],
        outdir: join(import.meta.dir, 'dist'),
        plugins: [
            {
                name: 'ax-sources',
                setup(b) {
                    b.onResolve({ filter: /^@ax-design\/(surface|shape|typed-om|reveal-highlight|acrylic)$/ }, (args) => (sources[args.path] ? { path: sources[args.path] } : undefined));
                },
            },
        ],
    });
    if (!result.success) throw new Error(result.logs.join('\n'));
}

if (import.meta.main) await build(process.argv[2]);
