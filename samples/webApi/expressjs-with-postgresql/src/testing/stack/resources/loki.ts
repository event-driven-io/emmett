import { URLS } from '../../../stack';

export async function diagLoki() {
  const labels = await fetch(`${URLS.loki}/loki/api/v1/labels`)
    .then((r) => r.json() as Promise<{ data?: string[] }>)
    .catch(() => ({ data: [] as string[] }));
  console.log(`\n  Loki labels: ${(labels.data ?? []).join(', ') || '(none)'}`);
}
