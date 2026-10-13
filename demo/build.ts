// Builds a demo page with sibling packages resolved to their sources: bun demo/build.ts compare
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const sources: Record<string, string> = {
    '@ax-design/surface': join(root, 'surface/src/index.ts'),
    '@ax-design/shape': join(root, 'shape/src/index.ts'),
    '@ax-design/typed-om': join(root, 'typed-om/src/index.ts'),
};
const name = process.argv[2] || 'index';
const result = await Bun.build({
    entrypoints: [join(import.meta.dir, `${name}.html`)],
    outdir: join(import.meta.dir, 'dist'),
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
