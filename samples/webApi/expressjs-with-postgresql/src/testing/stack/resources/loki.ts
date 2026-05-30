import { httpHealthCheck } from '../healthCheck';
import { getJson } from '../http';
import type { Resource } from '../types';
import { verifications } from '../verify';

export type LokiOptions = { url: string; timeout?: number };

// A view over the Loki container. `queryRange` runs a LogQL query over the last
// `sinceMs` and returns how many streams matched; `diagnose` dumps the known labels.
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
    diagnose,
  } satisfies Resource & {
    queryRange: typeof queryRange;
    diagnose: typeof diagnose;
  };
};
