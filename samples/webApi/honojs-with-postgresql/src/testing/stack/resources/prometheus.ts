import { waitFor } from '../../index';
import { httpHealthCheck } from '../healthCheck';
import { getJson } from '../http';
import { resource } from './resource';

export type PrometheusOptions = { url: string; timeout?: number };

// A view over the Prometheus container that compose owns. Its metric queries live
// under `metrics`; `diagnose` (the failure dump) stays top-level.
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

  const diagnose = async (prefix = ''): Promise<void> => {
    const json = await getJson<{ data: string[] }>(
      `${opts.url}/api/v1/label/__name__/values`,
    ).catch(() => ({ data: [] as string[] }));
    const names = prefix
      ? json.data.filter((n) => n.startsWith(prefix))
      : json.data;
    const label = prefix ? `${prefix}* metrics` : 'metrics';
    console.log(
      names.length
        ? `\n  Prometheus ${label}: ${names.slice(0, 20).join(', ')}`
        : `\n  Prometheus: no ${label} found yet`,
    );
  };

  const ready = httpHealthCheck('Prometheus', `${opts.url}/-/ready`, {
    timeout: opts.timeout ?? 90_000,
  });

  return {
    ...resource({ name: 'prometheus', up: ready, healthCheck: ready }),
    metrics: { queryInstant, rate, waitForNonZeroRate },
    diagnose,
  };
};
