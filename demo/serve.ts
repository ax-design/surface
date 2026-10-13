// Demo server: bun run demo. Rebuilds on every page load, so a reload shows your changes.
import { join } from 'node:path';
import { build } from './build.ts';

const dist = join(import.meta.dir, 'dist');
const server = Bun.serve({
    port: Number(process.env.PORT || 3000),
    async fetch(req) {
        let path = new URL(req.url).pathname;
        if (path === '/' || path.endsWith('.html')) {
            const page = path === '/' ? 'index' : path.slice(1, -5);
            try {
                await build(page);
            } catch (error) {
                return new Response(String(error), { status: 500 });
            }
            path = `/${page}.html`;
        }
        const file = Bun.file(join(dist, path));
        return (await file.exists()) ? new Response(file) : new Response('Not found', { status: 404 });
    },
});
console.log(server.url.href);
