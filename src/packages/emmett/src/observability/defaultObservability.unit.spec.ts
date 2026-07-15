import { collectingTracer } from '@event-driven-io/almanac';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupObservability } from './defaultObservability';

describe('default observability', () => {
  afterEach(() => setupObservability(undefined));

  it('is shared across Emmett module instances', async () => {
    const tracer = collectingTracer();
    setupObservability({ tracer });

    vi.resetModules();
    const { commandObservability: commandObservabilityFromAnotherModule } =
      await import('../commandHandling/observability');

    expect(commandObservabilityFromAnotherModule(undefined).tracer).toBe(
      tracer,
    );
  });
});
