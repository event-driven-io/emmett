import type { Instrumentation } from '@opentelemetry/instrumentation';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  currentDefaultObservability,
  mergeWithDefaultObservability,
  setupEmmettObservability,
} from '../defaultObservability';
import type { EmmettObservabilityConfig } from '../options';
import { EmmettInstrumentation } from './emmettInstrumentation';

describe('EmmettInstrumentation', () => {
  beforeEach(() => {
    setupEmmettObservability(undefined);
  });

  afterEach(() => {
    setupEmmettObservability(undefined);
  });

  it('registers its tracer into the single store on enable', () => {
    new EmmettInstrumentation();

    const merged = mergeWithDefaultObservability(undefined, undefined);

    expect(merged?.tracer).toBeDefined();
  });

  it('defaults the attribute prefix to emmett', () => {
    new EmmettInstrumentation();

    const merged = mergeWithDefaultObservability(undefined, undefined);

    expect(merged?.attributePrefix).toBe('emmett');
  });

  it('writes the Emmett-only fields into the store via buildObservability', () => {
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
    setupEmmettObservability(sentinel);

    const instrumentation = new EmmettInstrumentation();
    expect(currentDefaultObservability()).not.toBe(sentinel);

    instrumentation.disable();
    expect(currentDefaultObservability()).toBe(sentinel);
  });

  it('is registrable in a NodeSDK instrumentations array', () => {
    const instrumentation = new EmmettInstrumentation({ enabled: false });
    const instrumentations: Instrumentation[] = [instrumentation];

    const sdk = new NodeSDK({ instrumentations });

    expect(sdk).toBeDefined();

    instrumentation.enable();
    expect(currentDefaultObservability()?.tracer).toBeDefined();
  });
});
