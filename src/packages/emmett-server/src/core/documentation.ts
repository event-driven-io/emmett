import { EventStoreApiRoutes, type RouteDescriptor } from '../contract';

const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/**
 * Minimal, dependency-free HTML documentation generated from the route contract.
 */
export const documentationPage = (options: {
  apiRoot: string;
  openApiHref: string;
  routes?: RouteDescriptor[];
}): string => {
  const routes = options.routes ?? EventStoreApiRoutes;
  const rows = routes
    .map(
      (route) =>
        `<tr><td><code>${route.method}</code></td><td><code>${escapeHtml(
          `${options.apiRoot}${route.path}` || '/',
        )}</code></td><td>${escapeHtml(route.summary)}</td></tr>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Emmett Event Store API</title>
<style>body{font-family:system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;line-height:1.5}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:.4rem;text-align:left}code{font-size:.9em}</style>
</head>
<body>
<h1>Emmett Event Store API</h1>
<p>The machine-readable contract is the <a href="${escapeHtml(options.openApiHref)}">OpenAPI 3.1 document</a>.</p>
<h2>Endpoints</h2>
<table><thead><tr><th>Method</th><th>Path</th><th>Purpose</th></tr></thead>
<tbody>
${rows}
</tbody></table>
<h2 id="concurrency">Optimistic concurrency</h2>
<p>Stream resources return a strong ETag holding the current stream version. Appends express the expected version with conditional headers.</p>
<table><thead><tr><th>Expectation</th><th>Request header</th></tr></thead>
<tbody>
<tr><td>exact version 42</td><td><code>If-Match: "42"</code></td></tr>
<tr><td>stream exists</td><td><code>If-Match: *</code></td></tr>
<tr><td>stream does not exist</td><td><code>If-None-Match: *</code></td></tr>
<tr><td>no concurrency check</td><td>omit both headers</td></tr>
</tbody></table>
<p>A failed expectation returns <code>412 Precondition Failed</code> with the current ETag. Weak ETags, lists of tags and contradictory headers return <code>400 Bad Request</code>.</p>
<h2>Representations</h2>
<p>Resources are available as <code>application/json</code>, <code>application/hal+json</code> and <code>application/prs.hal-forms+json</code>. Messages can also be streamed as an RFC 7464 <code>application/json-seq</code> sequence. Errors use RFC 9457 <code>application/problem+json</code>.</p>
</body>
</html>`;
};
