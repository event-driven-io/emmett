import type { Instrumentation } from '@opentelemetry/instrumentation';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mergeWithDefaultObservability,
  setupObservability,
} from '../defaultObservability';
import type { EmmettObservabilityConfig } from '../options';
import { EmmettInstrumentation } from './emmettInstrumentation';

describe('EmmettInstrumentation', () => {
  beforeEach(() => {
    setupObservability(undefined);
  });

  afterEach(() => {
    setupObservability(undefined);
  });

  it('registers its tracer into the merge chain on enable', () => {
    new EmmettInstrumentation();

    const merged = mergeWithDefaultObservability(undefined, undefined);

    expect(merged?.tracer).toBeDefined();
  });

  it('carries Emmett config into the merge chain', () => {
    new EmmettInstrumentation({
      pollTracing: 'verbose',
      includeMessagePayloads: true,
    });

    const merged = mergeWithDefaultObservability(undefined, undefined);

    expect(merged?.pollTracing).toBe('verbose');
    expect(merged?.includeMessagePayloads).toBe(true);
  });

  it('restores the prior default observability on disable', () => {
    const sentinel = { pollTracing: 'active' } as EmmettObservabilityConfig;
    setupObservability(sentinel);

    const instrumentation = new EmmettInstrumentation();
    expect(globalThis.eventDrivenIoEmmettDefaultObservability).not.toBe(
      sentinel,
    );

    instrumentation.disable();
    expect(globalThis.eventDrivenIoEmmettDefaultObservability).toBe(sentinel);
  });

  it('is registrable as an OTel Instrumentation', () => {
    const instrumentations: Instrumentation[] = [new EmmettInstrumentation()];

    expect(instrumentations).toHaveLength(1);
  });
});
