import { afterEach, describe, expect, it } from 'vitest';
import { noopTracer } from '../tracers';
import type { Observability } from './options';
import {
  currentDefaultObservability,
  mergeWithDefaultObservability,
  setupObservability,
} from './defaultObservability';

type TestObservability = Partial<Observability<string>>;

describe('default observability store', () => {
  afterEach(() => setupObservability(undefined));

  it('returns the value that was set as the current default', () => {
    const observability: TestObservability = { tracer: noopTracer() };

    setupObservability(observability);

    expect(currentDefaultObservability()).toBe(observability);
  });

  it('clears the current default when set to undefined', () => {
    setupObservability({ tracer: noopTracer() });

    setupObservability(undefined);

    expect(currentDefaultObservability()).toBeUndefined();
  });

  it('merges global default, parent and local with local winning', () => {
    const globalTracer = noopTracer();
    const parentTracer = noopTracer();
    const localTracer = noopTracer();

    setupObservability({ tracer: globalTracer, attributePrefix: 'global' });

    const merged = mergeWithDefaultObservability(
      { tracer: parentTracer, attributePrefix: 'parent' },
      { tracer: localTracer },
    );

    expect(merged?.tracer).toBe(localTracer);
    expect(merged?.attributePrefix).toBe('parent');
  });

  it('falls back to the global default when parent and local are undefined', () => {
    const globalTracer = noopTracer();
    setupObservability({ tracer: globalTracer });

    const merged = mergeWithDefaultObservability(undefined, undefined);

    expect(merged?.tracer).toBe(globalTracer);
  });
});
