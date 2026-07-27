import type { Resource } from '../composition';

// The primitive every resource builds on: takes a partial Resource and fills the
// methods you didn't supply. It knows nothing about HTTP or readiness — a resource
// that needs a probe builds its own and passes it as up/healthCheck.
export const resource = (r: Partial<Resource> & { name: string }): Resource => {
  const up = r.up ?? (async () => {});
  const down = r.down ?? (async () => {});
  return {
    name: r.name,
    up,
    down,
    restart:
      r.restart ??
      (async (opts) => {
        await down();
        await up(opts);
      }),
    healthCheck: r.healthCheck ?? (async () => {}),
    verify: r.verify ?? (async () => {}),
    ...(r.children ? { children: r.children, mode: r.mode } : {}),
  };
};
