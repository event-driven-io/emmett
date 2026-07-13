import { collectingTracer } from '@event-driven-io/almanac';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDefaultObservability } from './defaultObservability';

describe('default observability', () => {
  afterEach(() => setDefaultObservability(undefined));

  it('is shared across Emmett module instances', async () => {
    const tracer = collectingTracer();
    setDefaultObservability({ tracer });

    vi.resetModules();
    const { commandObservability: commandObservabilityFromAnotherModule } =
      await import('../commandHandling/observability');

    expect(commandObservabilityFromAnotherModule(undefined).tracer).toBe(
      tracer,
    );
  });
});
