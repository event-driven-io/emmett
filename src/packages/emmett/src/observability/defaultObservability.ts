import {
  currentDefaultObservability as currentAlmanacDefaultObservability,
  mergeWithDefaultObservability as mergeWithAlmanacDefaultObservability,
  setupObservability as setupAlmanacObservability,
  type DefaultObservability,
} from '@event-driven-io/almanac';
import type { EmmettObservabilityConfig } from './options';

const asEmmettObservability = (
  observability: DefaultObservability | undefined,
): EmmettObservabilityConfig | undefined =>
  observability as EmmettObservabilityConfig | undefined;

export function setupEmmettObservability(
  observability: EmmettObservabilityConfig,
): EmmettObservabilityConfig;
export function setupEmmettObservability(observability: undefined): undefined;
export function setupEmmettObservability(
  observability: EmmettObservabilityConfig | undefined,
): EmmettObservabilityConfig | undefined {
  if (observability === undefined) return setupAlmanacObservability(undefined);

  setupAlmanacObservability(observability);
  return observability;
}

export const currentDefaultObservability = ():
  EmmettObservabilityConfig | undefined =>
  asEmmettObservability(currentAlmanacDefaultObservability());

export const mergeWithDefaultObservability = (
  parent: EmmettObservabilityConfig | undefined,
  local: EmmettObservabilityConfig | undefined,
) => asEmmettObservability(mergeWithAlmanacDefaultObservability(parent, local));
