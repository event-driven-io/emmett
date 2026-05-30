import assert from 'node:assert/strict';
import { httpHealthCheck } from '../healthCheck';
import type { Resource } from '../types';
import { verifications } from '../verify';

export type GrafanaOptions = { url: string; service: string; timeout?: number };

// A view over the Grafana container. Its two verifications are self-contained — they
// only query Grafana — so they live here; `searchDashboards` and `queryDatasource`
// are the typed fetch wrappers they share.
export const grafana = (opts: GrafanaOptions) => {
  const searchDashboards = async (
    query: string,
  ): Promise<Array<{ uid: string; title: string }>> => {
    const res = await fetch(
      `${opts.url}/api/search?query=${encodeURIComponent(query)}&type=dash-db`,
    );
    return (await res.json()) as Array<{ uid: string; title: string }>;
  };

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
    name: 'grafana',
    up: async () => ready(),
    down: async () => {},
    restart: async () => {},
    healthCheck: ready,
    verify: verifications({
      dashboardProvisioned: {
        name: 'Grafana has Emmett dashboard provisioned',
        verify: async () => {
          const dashboards = await searchDashboards('Emmett');
          if (!dashboards.some((d) => d.uid === 'emmett-observability')) {
            console.error(
              `\n  ✗ dashboard not found. Grafana returned:\n  ${JSON.stringify(dashboards)}\n` +
                '  Check docker/observability/grafana/dashboards.yml is mounted in docker-compose.yml',
            );
          }
          assert.ok(
            dashboards.some((d) => d.uid === 'emmett-observability'),
            'Emmett dashboard not provisioned in Grafana',
          );
        },
      },
      datasourceReturnsData: {
        name: 'Grafana Prometheus datasource returns Emmett metric data',
        verify: async () => {
          const { ok, status, frames } = await queryDatasource(
            'prometheus',
            `sum(rate(emmett_command_handling_duration_count{service_name="${opts.service}"}[5m]))`,
          );
          assert.ok(ok, `Grafana datasource proxy returned ${status}`);
          if (frames.length === 0) {
            console.error(
              '\n  ✗ no frames from Grafana datasource proxy\n' +
                '  Check: uid "prometheus" in docker/observability/grafana/datasources.yml\n' +
                '  and that Prometheus has emmett_* metrics (run the Prometheus test first)',
            );
          }
          assert.ok(
            frames.length > 0,
            'No frames — Grafana datasource or metrics missing',
          );
        },
      },
    }),
    searchDashboards,
    queryDatasource,
  } satisfies Resource & {
    searchDashboards: typeof searchDashboards;
    queryDatasource: typeof queryDatasource;
  };
};
