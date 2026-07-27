import { waitFor } from '../../index';
import { httpHealthCheck } from '../healthCheck';
import { resource } from './resource';

export type TempoOptions = { url: string; timeout?: number };

type TraceBatch = { scopeSpans: Array<{ spans: Array<{ name: string }> }> };

// A view over the Tempo container. Trace reads live under `traces`: `spans` is the
// low-level read (returns [] until the trace is ingested); `waitForSpan` polls until
// a named span shows up and returns the trace's span names.
export const tempo = (opts: TempoOptions) => {
  const spans = async (traceId: string): Promise<string[]> => {
    const res = await fetch(`${opts.url}/api/traces/${traceId}`);
    if (!res.ok) return [];
    const json = (await res.json()) as { batches?: TraceBatch[] };
    return (json.batches ?? []).flatMap((b) =>
      b.scopeSpans.flatMap((s) => s.spans.map((sp) => sp.name)),
    );
  };

  const waitForSpan = async (
    traceId: string,
    spanName: string,
    o?: { timeout?: number },
  ): Promise<string[]> => {
    let found: string[] = [];
    await waitFor(
      async () => {
        found = await spans(traceId);
        return found.includes(spanName);
      },
      {
        timeout: o?.timeout ?? 30_000,
        interval: 2_000,
        label: `span "${spanName}" of trace ${traceId} in Tempo`,
      },
    );
    return found;
  };

  const ready = httpHealthCheck('Tempo', `${opts.url}/ready`, {
    timeout: opts.timeout ?? 90_000,
  });

  return {
    ...resource({ name: 'tempo', up: ready, healthCheck: ready }),
    traces: { spans, waitForSpan },
  };
};
