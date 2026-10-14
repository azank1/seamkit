import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
};

/**
 * A local stand-in for production, for tests and the demo. It serves whatever was last deployed to
 * it from memory on 127.0.0.1, and can be told to fail or hang on a path. With `spaFallback` it
 * answers unknown paths without an extension with its index page, as many hosted sites do.
 */
export class FakeProduction {
  readonly requests: string[] = [];
  private files = new Map<string, Buffer>();
  private readonly failures = new Map<string, number | 'hang'>();

  private constructor(
    private readonly server: Server,
    readonly url: string,
    private readonly spaFallback: boolean,
  ) {}

  static async start(options: { spaFallback?: boolean } = {}): Promise<FakeProduction> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const fake = new FakeProduction(server, `http://127.0.0.1:${port}/`, options.spaFallback === true);
    server.on('request', (req, res) => {
      const path = decodeURIComponent(new URL(req.url ?? '/', fake.url).pathname);
      fake.requests.push(path);
      const failure = fake.failures.get(path);
      if (failure === 'hang') return;
      if (failure !== undefined) {
        res.writeHead(failure).end();
        return;
      }
      let key = path.replace(/^\/+/, '');
      if (key === '' || key.endsWith('/')) key += 'index.html';
      let body = fake.files.get(key);
      if (body === undefined && fake.spaFallback && !/\.[A-Za-z0-9]+$/.test(key)) {
        key = 'index.html';
        body = fake.files.get(key);
      }
      if (body === undefined || (req.method !== 'GET' && req.method !== 'HEAD')) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      const type = TYPES[key.slice(key.lastIndexOf('.') + 1)] ?? 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'content-length': body.length }).end(req.method === 'HEAD' ? undefined : body);
    });
    return fake;
  }

  /** Replaces everything served. Paths are relative, such as `index.html` or `assets/app-1a2b.js`. */
  deploy(files: Readonly<Record<string, string | Uint8Array>>): void {
    this.files = new Map(Object.entries(files).map(([path, body]) => [path, Buffer.from(body)]));
    this.failures.clear();
  }

  failWith(path: string, status: number | 'hang'): void {
    this.failures.set(path, status);
  }

  close(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve, reject) => this.server.close((err) => (err ? reject(err) : resolve())));
  }
}
