import http from 'node:http';

/**
 * Worldview additions to the globe app's dev/preview server:
 * - forward /api/news/* to the Python news service, so the browser only ever
 *   talks to one address (the app's Content-Security-Policy allows `connect-src 'self'`);
 * - make the Worldview globe the home page. A bare "/" goes to /globe.html; the
 *   original interface stays at /index.html, and "/" with a query string (the
 *   engine's own share and embed links) is left alone.
 * Must be installed before apiNotFoundPlugin, which answers unknown /api routes.
 */
export function worldviewNewsProxyPlugin({
  target = process.env.WORLDVIEW_NEWS_URL ?? 'http://127.0.0.1:8765',
} = {}) {
  const upstream = new URL(target);
  const install = (server) => {
    server.middlewares.use((req, res, next) => {
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(302, { Location: '/globe.html' });
        res.end();
      } else next();
    });
    server.middlewares.use('/api/news', (req, res) => {
      const forward = http.request(
        {
          hostname: upstream.hostname,
          port: upstream.port,
          method: req.method,
          path: `/api/news${req.url}`,
          headers: { ...req.headers, host: upstream.host },
        },
        (reply) => {
          res.writeHead(reply.statusCode ?? 502, reply.headers);
          reply.pipe(res);
        },
      );
      forward.on('error', () => {
        if (res.headersSent) return res.end();
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error:
              'The news service is not running. Start Worldview with ./start.sh',
          }),
        );
      });
      req.pipe(forward);
    });
  };
  return {
    name: 'worldview-news-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
