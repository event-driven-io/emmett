import { httpHealthCheck } from '../healthCheck';
import { getJson } from '../http';
import { resource } from './resource';

export type GrafanaOptions = { url: string; timeout?: number };

// A view over the Grafana container. Reads live under `api`; what to assert about a
// specific app's dashboards/metrics is the caller's concern, not this resource's.
export const grafana = (opts: GrafanaOptions) => {
  const searchDashboards = (
    query: string,
  ): Promise<Array<{ uid: string; title: string }>> =>
    getJson<Array<{ uid: string; title: string }>>(
      `${opts.url}/api/search?query=${encodeURIComponent(query)}&type=dash-db`,
    );

  const queryDatasource = async (
    uid: string,
    expr: string,
  ): Promise<{ ok: boolean; status: number; frames: unknown[] }> => {
    const res = await fetch(`${opts.url}/api/ds/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queries: [
          {
            datasource: { type: 'prometheus', uid },
            expr,
            refId: 'A',
            instant: true,
          },
        ],
        from: 'now-5m',
        to: 'now',
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      results?: { A?: { frames?: unknown[] } };
    };
    return {
      ok: res.ok,
      status: res.status,
      frames: json.results?.A?.frames ?? [],
    };
  };

  const ready = httpHealthCheck('Grafana', `${opts.url}/api/health`, {
    timeout: opts.timeout ?? 90_000,
  });

  return {
    ...resource({ name: 'grafana', up: ready, healthCheck: ready }),
    api: { searchDashboards, queryDatasource },
  };
};
