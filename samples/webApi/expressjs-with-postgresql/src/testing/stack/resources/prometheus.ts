import { URLS } from '../../../stack';

export async function diagPrometheus() {
  const json = await fetch(`${URLS.prometheus}/api/v1/label/__name__/values`)
    .then((r) => r.json() as Promise<{ data: string[] }>)
    .catch(() => ({ data: [] as string[] }));
  const emmett = json.data.filter((n) => n.startsWith('emmett_'));
  console.log(
    emmett.length
      ? `\n  Prometheus emmett_* metrics: ${emmett.join(', ')}`
      : '\n  Prometheus: no emmett_* metrics found yet',
  );
}
