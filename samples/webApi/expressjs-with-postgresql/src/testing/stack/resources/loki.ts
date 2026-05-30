import { waitFor } from '../../index';
import { httpHealthCheck } from '../healthCheck';
import { getJson } from '../http';
import type { Resource } from '../types';
import { verifications } from '../verify';

export type LokiOptions = { url: string; timeout?: number };

// A view over the Loki container. `queryRange` is the low-level read; `serviceLogs` /
// `waitForServiceLogs` are the intention-revealing helpers; `diagnose` dumps labels.
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
  const serviceLogs = (service: string): Promise<number> =>
    queryRange(`{service_name="${service}"}`);

  const waitForServiceLogs = async (
    service: string,
    o?: { timeout?: number },
  ): Promise<void> => {
    await waitFor(
      async () => {
        const count = await serviceLogs(service);
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
    const labels = await getJson<{ data?: string[] }>(
      `${opts.url}/loki/api/v1/labels`,
    ).catch(() => ({ data: [] as string[] }));
    console.log(
      `\n  Loki labels: ${(labels.data ?? []).join(', ') || '(none)'}`,
    );
  };

  const ready = httpHealthCheck('Loki', `${opts.url}/ready`, {
    timeout: opts.timeout ?? 90_000,
  });

  return {
    name: 'loki',
    up: async () => ready(),
    down: async () => {},
    restart: async () => {},
    healthCheck: ready,
    verify: verifications({}),
    queryRange,
    serviceLogs,
    waitForServiceLogs,
    diagnose,
  } satisfies Resource & {
    queryRange: typeof queryRange;
    serviceLogs: typeof serviceLogs;
    waitForServiceLogs: typeof waitForServiceLogs;
    diagnose: typeof diagnose;
  };
};
