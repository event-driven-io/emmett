export type WaitForOptions = {
  timeout?: number;
  interval?: number;
  label?: string;
};

export async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  options: WaitForOptions = {},
): Promise<void> {
  const { timeout = 30_000, interval = 1_000, label = 'condition' } = options;
  const deadline = Date.now() + timeout;

  console.log(`  ⏳ waiting for: ${label}`);
  let attempts = 0;

  while (Date.now() < deadline) {
    try {
      if (await predicate()) {
        console.log(`  ✓ ready: ${label}`);
        return;
      }
    } catch (err) {
      // predicate threw — not ready yet, keep waiting
    }
    attempts++;
    if (attempts % 5 === 0) {
      const remaining = Math.round((deadline - Date.now()) / 1000);
      console.log(`  ⏳ still waiting for: ${label} (${remaining}s left)`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error(`Timed out waiting for: ${label} (${timeout}ms)`);
}

export async function checkUrl(
  label: string,
  url: string,
  validate?: (res: Response) => Promise<boolean> | boolean,
): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    console.log(`    ${label}: connection refused (${url})`);
    return false;
  }

  const ok = validate ? await validate(res).catch(() => false) : res.ok;

  if (!ok) {
    const body = await res.text().catch(() => '');
    const snippet = body.slice(0, 200).replace(/\n/g, ' ');
    console.log(`    ${label}: HTTP ${res.status} — ${snippet || '(empty body)'}`);
  }

  return ok;
}
