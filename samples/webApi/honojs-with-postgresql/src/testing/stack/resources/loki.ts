import { waitFor } from '../../index';
import { httpHealthCheck } from '../healthCheck';
import { getJson } from '../http';
import { resource } from './resource';

export type LokiOptions = { url: string; timeout?: number };

// A view over the Loki container. Log queries live under `logs`; `diagnose` (the
// failure dump) stays top-level and lists the service names Loki has actually seen.
export const loki = (opts: LokiOptions) => {
  const queryRange = async (
    logql: string,
    sinceMs = 300_000,
  ): Promise<number> => {
    const now = Date.now();
    const json = await getJson<{ data: { result: unknown[] } }>(
      `${opts.url}/loki/api/v1/query_range?query=${encodeURIComponent(logql)}&limit=10` +
        `&start=${(now - sinceMs) * 1_000_000}&end=${now * 1_000_000}`,
    );
    return json.data?.result?.length ?? 0;
  };

  // How many log streams the service emitted recently.
  const forService = (service: string): Promise<number> =>
    queryRange(`{service_name="${service}"}`);

  const waitForService = async (
    service: string,
    o?: { timeout?: number },
  ): Promise<void> => {
    await waitFor(
      async () => {
        const count = await forService(service);
        if (count === 0) console.log('    Loki: no log streams yet');
        return count > 0;
      },
      {
        timeout: o?.timeout ?? 30_000,
        interval: 3_000,
        label: `logs from ${service} in Loki`,
      },
    );
  };

  const diagnose = async (): Promise<void> => {
    const { data } = await getJson<{ data?: string[] }>(
      `${opts.url}/loki/api/v1/label/service_name/values`,
    ).catch(() => ({ data: [] as string[] }));
    const services = data ?? [];
    console.log(
      services.length
        ? `\n  Loki service_name values: ${services.join(', ')}`
        : '\n  Loki: no service_name label values yet',
    );
  };

  const ready = httpHealthCheck('Loki', `${opts.url}/ready`, {
    timeout: opts.timeout ?? 90_000,
  });

  return {
    ...resource({ name: 'loki', up: ready, healthCheck: ready }),
    logs: { queryRange, forService, waitForService },
    diagnose,
  };
};
