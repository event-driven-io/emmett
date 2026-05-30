import { waitFor } from '../../index';
import { httpHealthCheck } from '../healthCheck';
import { fetchText } from '../http';
import type { Resource } from '../types';
import { verifications } from '../verify';

export type OtelCollectorOptions = {
  url: string; // the Prometheus-exporter /metrics endpoint (e.g. :8889/metrics)
  logs: (lines?: number) => Promise<void>; // container logs, from the compose service
  timeout?: number;
};

// A view over the OTel collector container that compose owns. Its metric helpers are
// generic — pass the metric name/prefix you're after — and come in a single-shot read
// plus a polling `waitForMetrics` built on it.
export const otelCollector = (opts: OtelCollectorOptions) => {
  const metrics = (): Promise<string> => fetchText(opts.url);

  const linesWith = (text: string, prefix: string): string[] =>
    text.split('\n').filter((l) => l.startsWith(prefix) && !l.startsWith('#'));

  const metricNames = async (prefix: string): Promise<string[]> =>
    linesWith(await metrics().catch(() => ''), prefix);

  const hasMetrics = async (prefix: string): Promise<boolean> =>
    (await metricNames(prefix)).length > 0;

  const waitForMetrics = async (
    prefix: string,
    o?: { timeout?: number },
  ): Promise<void> => {
    await waitFor(
      async () => {
        const text = await metrics().catch(() => {
          console.log('    collector: connection refused');
          return '';
        });
        if (linesWith(text, prefix).length > 0) return true;
        const families = [
          ...new Set(
            text
              .split('\n')
              .filter((l) => !l.startsWith('#') && l)
              .map((l) => l.split('{')[0]),
          ),
        ].slice(0, 5);
        console.log(
          `    collector: no ${prefix}* metrics yet. Present: ${families.join(', ') || '(none)'}`,
        );
        return false;
      },
      {
        timeout: o?.timeout ?? 90_000,
        interval: 5_000,
        label: `${prefix}* metrics on collector`,
      },
    );
  };

  const diagnose = async (prefix = 'emmett_'): Promise<void> => {
    const lines = (await metricNames(prefix)).slice(0, 5);
    console.log(
      lines.length
        ? `\n  collector /metrics (${prefix} lines):\n  ${lines.join('\n  ')}`
        : `\n  collector /metrics: no ${prefix}* lines found`,
    );
  };

  const ready = httpHealthCheck('OTel collector', opts.url, {
    timeout: opts.timeout ?? 90_000,
  });

  return {
    name: 'otel-collector',
    up: async () => ready(),
    down: async () => {},
    restart: async () => {},
    healthCheck: ready,
    verify: verifications({}),
    metrics,
    metricNames,
    hasMetrics,
    waitForMetrics,
    diagnose,
    logs: opts.logs,
  } satisfies Resource & {
    metrics: typeof metrics;
    metricNames: typeof metricNames;
    hasMetrics: typeof hasMetrics;
    waitForMetrics: typeof waitForMetrics;
    diagnose: typeof diagnose;
    logs: typeof opts.logs;
  };
};
