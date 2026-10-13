// Builds the bench page. Sibling packages resolve to their sources, one copy each, so layers from
// other repositories register into the same surface registry.
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const sources: Record<string, string> = {
    '@ax-design/surface': join(root, 'surface/src/index.ts'),
    '@ax-design/shape': join(root, 'shape/src/index.ts'),
    '@ax-design/typed-om': join(root, 'typed-om/src/index.ts'),
};

const result = await Bun.build({
    entrypoints: [join(import.meta.dir, 'page.html')],
    outdir: join(import.meta.dir, 'dist'),
    minify: !process.argv.includes('--no-minify'),
    plugins: [
        {
            name: 'ax-sources',
            setup(build) {
                build.onResolve({ filter: /^@ax-design\/(surface|shape|typed-om)$/ }, (args) => ({ path: sources[args.path] }));
            },
        },
    ],
});
if (!result.success) {
    console.error(result.logs.join('\n'));
    process.exit(1);
}
