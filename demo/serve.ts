// Demo server: bun demo/serve.ts
import page from './index.html';

const server = Bun.serve({ port: Number(process.env.PORT || 0), routes: { '/': page }, development: true });
console.log(server.url.href);
