import { mergeObservability } from '@event-driven-io/almanac';
import type { EmmettObservabilityConfig } from './options';

declare global {
  var eventDrivenIoEmmettDefaultObservability:
    EmmettObservabilityConfig | undefined;
}

export const setDefaultObservability = (
  observability: EmmettObservabilityConfig | undefined,
): void => {
  globalThis.eventDrivenIoEmmettDefaultObservability = observability;
};

export const mergeDefaultObservability = (
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
