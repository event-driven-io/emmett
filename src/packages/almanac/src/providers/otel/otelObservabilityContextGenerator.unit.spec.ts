import { isValidSpanId, isValidTraceId } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { otelObservabilityContextGenerator } from './otelObservabilityContextGenerator';

describe('otelObservabilityContextGenerator', () => {
  it('generates trace ids accepted by OTel', () => {
    expect(
      isValidTraceId(otelObservabilityContextGenerator.generateTraceId()),
    ).toBe(true);
  });

  it('generates span ids accepted by OTel', () => {
    expect(
      isValidSpanId(otelObservabilityContextGenerator.generateSpanId()),
    ).toBe(true);
  });

  it('generates message, correlation and causation ids in the trace id format', () => {
    expect(
      isValidTraceId(otelObservabilityContextGenerator.generateMessageId()),
    ).toBe(true);
    expect(
      isValidTraceId(otelObservabilityContextGenerator.generateCorrelationId()),
    ).toBe(true);
    expect(
      isValidTraceId(otelObservabilityContextGenerator.generateCausationId()),
    ).toBe(true);
  });

  it('generates a different id on each call', () => {
    expect(otelObservabilityContextGenerator.generateTraceId()).not.toBe(
      otelObservabilityContextGenerator.generateTraceId(),
    );
    expect(otelObservabilityContextGenerator.generateSpanId()).not.toBe(
      otelObservabilityContextGenerator.generateSpanId(),
    );
  });
});
