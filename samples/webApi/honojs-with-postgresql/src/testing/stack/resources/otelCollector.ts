import { waitFor } from '../../index';
import { httpHealthCheck } from '../healthCheck';
import { fetchText } from '../http';
import { resource } from './resource';

export type OtelCollectorOptions = {
  url: string; // the Prometheus-exporter /metrics endpoint (e.g. :8889/metrics)
  logs: (lines?: number) => Promise<void>; // container logs, from the compose service
  timeout?: number;
};

// A view over the OTel collector container that compose owns. Its metric helpers are
// generic — pass the metric name/prefix you're after — and live under `metrics`.
// `diagnose` and the container `logs` (failure dumps) stay top-level.
export const otelCollector = (opts: OtelCollectorOptions) => {
  const raw = (): Promise<string> => fetchText(opts.url);

  const linesWith = (text: string, prefix: string): string[] =>
    text.split('\n').filter((l) => l.startsWith(prefix) && !l.startsWith('#'));

  const names = async (prefix: string): Promise<string[]> =>
    linesWith(await raw().catch(() => ''), prefix);

  const has = async (prefix: string): Promise<boolean> =>
    (await names(prefix)).length > 0;

  const waitForMetrics = async (
    prefix: string,
    o?: { timeout?: number },
  ): Promise<void> => {
    await waitFor(
      async () => {
        const text = await raw().catch(() => {
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

  const diagnose = async (prefix = ''): Promise<void> => {
    const lines = (await names(prefix)).slice(0, 5);
    const label = prefix ? `${prefix} lines` : 'lines';
    console.log(
      lines.length
        ? `\n  collector /metrics (${label}):\n  ${lines.join('\n  ')}`
        : `\n  collector /metrics: no ${label} found`,
    );
  };

  const ready = httpHealthCheck('OTel collector', opts.url, {
    timeout: opts.timeout ?? 90_000,
  });

  return {
    ...resource({ name: 'otel-collector', up: ready, healthCheck: ready }),
    metrics: { raw, names, has, waitFor: waitForMetrics },
    diagnose,
    logs: opts.logs,
  };
};
