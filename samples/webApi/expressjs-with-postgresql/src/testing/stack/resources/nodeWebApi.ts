import { checkUrl } from '../../index';
import { httpHealthCheck } from '../healthCheck';
import { nodeApp } from './nodeApp';

export type NodeWebApiOptions = {
  url: string;
  service: string;
  name?: string;
  command?: string;
  args?: string[];
  label?: string;
  inspectPort?: number;
};

type RequestSpec = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
};

// The application under test: a node web API. Wraps nodeApp (the process) and owns
// the HTTP surface — the /health readiness, foreign-process detection, and the
// request helpers the verifications use. The process runner is overridable (npm,
// node, nodemon, pm2…) via command/args.
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
    name: opts.name ?? 'app',
    command: opts.command ?? 'npm',
    args: opts.args ?? ['start'],
    url: opts.url,
    label: opts.label ?? opts.service,
    inspectPort: opts.inspectPort,
    healthCheck,
    isOurs,
  });

  const endpoint = (path = ''): string =>
    path ? `${opts.url}/${path}` : opts.url;

  const send = ({
    method = 'GET',
    path,
    body,
  }: RequestSpec): Promise<Response> =>
    fetch(endpoint(path), {
      method,
      headers:
        body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  const http = {
    endpoint,
    send,
    get: (path: string) => send({ method: 'GET', path }),
    post: (path: string, body?: unknown) =>
      send({ method: 'POST', path, body }),
    put: (path: string, body?: unknown) => send({ method: 'PUT', path, body }),
    delete: (path: string) => send({ method: 'DELETE', path }),
    // Steady load for rate() windows: replays one request every intervalMs until the
    // returned stop() is called. Any method/body, because it reuses send().
    traffic: (spec: RequestSpec, o?: { intervalMs?: number }): (() => void) => {
      const timer = setInterval(() => {
        void send(spec).catch(() => {});
      }, o?.intervalMs ?? 3_000);
      return () => clearInterval(timer);
    },
  };

  return { ...app, http };
};
