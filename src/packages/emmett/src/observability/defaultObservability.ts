import { mergeObservability } from '@event-driven-io/almanac';
import type { EmmettObservabilityConfig } from './options';

declare global {
  var eventDrivenIoEmmettDefaultObservability:
    EmmettObservabilityConfig | undefined;
}

export function setupObservability(
  observability: EmmettObservabilityConfig,
): EmmettObservabilityConfig;
export function setupObservability(observability: undefined): undefined;
export function setupObservability(
  observability: EmmettObservabilityConfig | undefined,
): EmmettObservabilityConfig | undefined {
  globalThis.eventDrivenIoEmmettDefaultObservability = observability;

  return observability;
}

export const mergeWithDefaultObservability = (
  parent: EmmettObservabilityConfig | undefined,
  local: EmmettObservabilityConfig | undefined,
) =>
  mergeObservability(
    mergeObservability(
      globalThis.eventDrivenIoEmmettDefaultObservability,
      parent,
    ),
    local,
  );
