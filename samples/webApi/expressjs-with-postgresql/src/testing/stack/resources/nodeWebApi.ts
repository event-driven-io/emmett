import { checkUrl } from '../../index';
import { httpHealthCheck } from '../healthCheck';
import type { Resource } from '../types';
import { nodeApp } from './nodeApp';

export type NodeWebApiOptions = {
  url: string;
  service: string;
  inspectPort?: number;
};

// The application under test: a node web API. Wraps nodeApp (the process) and owns
// the HTTP surface — the /health readiness, foreign-process detection, and the
// request helpers the verifications use.
export const nodeWebApi = (opts: NodeWebApiOptions) => {
  // /health returns { status: 'ok', service: 'expressjs-with-postgresql' } —
  // checking the service name distinguishes our app from other processes on the port.
  const validate = async (res: Response): Promise<boolean> => {
    const json = (await res.json().catch(() => ({}))) as { service?: string };
    if (json.service !== opts.service) {
      console.log(
        `    app /health: service="${json.service ?? '(missing)'}", expected="${opts.service}"`,
      );
      return false;
    }
    return true;
  };

  const healthCheck = httpHealthCheck('app /health', `${opts.url}/health`, {
    validate,
    timeout: 60_000,
  });
  const isOurs = () => checkUrl('app /health', `${opts.url}/health`, validate);

  const app = nodeApp({
    name: 'app',
    command: 'npm',
    args: ['start'],
    url: opts.url,
    label: opts.service,
    inspectPort: opts.inspectPort,
    healthCheck,
    isOurs,
  });

  const endpoint = (path = ''): string =>
    path ? `${opts.url}/${path}` : opts.url;

  const post = (path: string, body?: unknown): Promise<Response> =>
    fetch(endpoint(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  const get = (path: string): Promise<Response> => fetch(endpoint(path));

  // Drives steady traffic at the API; returns a stop function (for rate() windows).
  const traffic = (
    path: string,
    body?: unknown,
    intervalMs = 3_000,
  ): (() => void) => {
    const timer = setInterval(() => {
      void post(path, body).catch(() => {});
    }, intervalMs);
    return () => clearInterval(timer);
  };

  return { ...app, endpoint, post, get, traffic } satisfies Resource & {
    endpoint: typeof endpoint;
    post: typeof post;
    get: typeof get;
    traffic: typeof traffic;
  };
};
