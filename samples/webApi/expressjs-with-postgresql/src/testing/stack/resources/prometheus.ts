import { waitFor } from '../../index';
import { httpHealthCheck } from '../healthCheck';
import { getJson } from '../http';
import type { Resource } from '../types';
import { verifications } from '../verify';

export type PrometheusOptions = { url: string; timeout?: number };

// A view over the Prometheus container that compose owns: up/down are no-ops, the
// readiness probe hits /-/ready. `queryInstant` is the low-level read; `rate` /
// `waitForNonZeroRate` are the intention-revealing helpers the verifications use.
export const prometheus = (opts: PrometheusOptions) => {
  const queryInstant = async (promql: string): Promise<number> => {
    const json = await getJson<{
      data: { result: { value: [number, string] }[] };
    }>(`${opts.url}/api/v1/query?query=${encodeURIComponent(promql)}`);
    return parseFloat(json.data?.result?.[0]?.value?.[1] ?? '0');
  };

  // Per-second rate of `metric` for one service over the last 5m.
  const rate = (metric: string, service: string): Promise<number> =>
    queryInstant(`sum(rate(${metric}{service_name="${service}"}[5m]))`);

  const waitForNonZeroRate = async (
    metric: string,
    o: { service: string; timeout?: number },
  ): Promise<void> => {
    await waitFor(
      async () => {
        const value = await rate(metric, o.service);
        if (value > 0) return true;
        console.log(`    rate = ${value} — waiting for non-zero…`);
        return false;
      },
      {
        timeout: o.timeout ?? 120_000,
        interval: 5_000,
        label: `non-zero ${metric} rate in Prometheus`,
      },
    );
  };

  const diagnose = async (): Promise<void> => {
    const json = await getJson<{ data: string[] }>(
      `${opts.url}/api/v1/label/__name__/values`,
    ).catch(() => ({ data: [] as string[] }));
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
    rate,
    waitForNonZeroRate,
    diagnose,
  } satisfies Resource & {
    queryInstant: typeof queryInstant;
    rate: typeof rate;
    waitForNonZeroRate: typeof waitForNonZeroRate;
    diagnose: typeof diagnose;
  };
};
