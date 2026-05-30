import { httpHealthCheck } from '../healthCheck';
import type { Resource } from '../types';
import { verifications } from '../verify';

export type PrometheusOptions = { url: string; timeout?: number };

// A view over the Prometheus container that compose owns: up/down are no-ops, the
// readiness probe hits /-/ready, and `queryInstant` is the typed fetch wrapper the
// metric verifications share.
export const prometheus = (opts: PrometheusOptions) => {
  const queryInstant = async (promql: string): Promise<number> => {
    const json = await fetch(
      `${opts.url}/api/v1/query?query=${encodeURIComponent(promql)}`,
    ).then(
      (r) =>
        r.json() as Promise<{
          data: { result: { value: [number, string] }[] };
        }>,
    );
    return parseFloat(json.data?.result?.[0]?.value?.[1] ?? '0');
  };

  const diagnose = async (): Promise<void> => {
    const json = await fetch(`${opts.url}/api/v1/label/__name__/values`)
      .then((r) => r.json() as Promise<{ data: string[] }>)
      .catch(() => ({ data: [] as string[] }));
    const emmett = json.data.filter((n) => n.startsWith('emmett_'));
    console.log(
      emmett.length
        ? `\n  Prometheus emmett_* metrics: ${emmett.join(', ')}`
        : '\n  Prometheus: no emmett_* metrics found yet',
    );
  };

  const ready = httpHealthCheck('Prometheus', `${opts.url}/-/ready`, {
    timeout: opts.timeout ?? 90_000,
  });

  return {
    name: 'prometheus',
    up: async () => ready(),
    down: async () => {},
    restart: async () => {},
    healthCheck: ready,
    verify: verifications({}),
    queryInstant,
    diagnose,
  } satisfies Resource & {
    queryInstant: typeof queryInstant;
    diagnose: typeof diagnose;
  };
};
