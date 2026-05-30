import { httpHealthCheck } from '../healthCheck';
import type { Resource } from '../types';
import { verifications } from '../verify';

export type TempoOptions = { url: string; timeout?: number };

type TraceBatch = { scopeSpans: Array<{ spans: Array<{ name: string }> }> };

// A view over the Tempo container. `getSpans` fetches a trace by id and flattens it
// to span names; it returns [] when the trace hasn't been ingested yet, so callers
// can poll with waitFor until a span shows up.
export const tempo = (opts: TempoOptions) => {
  const getSpans = async (traceId: string): Promise<string[]> => {
    const res = await fetch(`${opts.url}/api/traces/${traceId}`);
    if (!res.ok) return [];
    const json = (await res.json()) as { batches?: TraceBatch[] };
    return (json.batches ?? []).flatMap((b) =>
      b.scopeSpans.flatMap((s) => s.spans.map((sp) => sp.name)),
    );
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
  } satisfies Resource & { getSpans: typeof getSpans };
};
