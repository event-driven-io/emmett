import { waitFor } from '../../index';
import { httpHealthCheck } from '../healthCheck';
import type { Resource } from '../types';
import { verifications } from '../verify';

export type TempoOptions = { url: string; timeout?: number };

type TraceBatch = { scopeSpans: Array<{ spans: Array<{ name: string }> }> };

// A view over the Tempo container. `getSpans` is the low-level read (returns [] until
// the trace is ingested); `waitForSpan` polls until a named span shows up and returns
// the trace's span names.
export const tempo = (opts: TempoOptions) => {
  const getSpans = async (traceId: string): Promise<string[]> => {
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
    let spans: string[] = [];
    await waitFor(
      async () => {
        spans = await getSpans(traceId);
        return spans.includes(spanName);
      },
      {
        timeout: o?.timeout ?? 30_000,
        interval: 2_000,
        label: `span "${spanName}" of trace ${traceId} in Tempo`,
      },
    );
    return spans;
  };

  const ready = httpHealthCheck('Tempo', `${opts.url}/ready`, {
    timeout: opts.timeout ?? 90_000,
  });

  return {
    name: 'tempo',
    up: async () => ready(),
    down: async () => {},
    restart: async () => {},
    healthCheck: ready,
    verify: verifications({}),
    getSpans,
    waitForSpan,
  } satisfies Resource & {
    getSpans: typeof getSpans;
    waitForSpan: typeof waitForSpan;
  };
};
