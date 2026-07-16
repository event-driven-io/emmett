import { mergeObservability } from './observability';
import type { Observability } from './options';

export type DefaultObservability = Partial<Observability<string>>;

declare global {
  var eventDrivenIoAlmanacDefaultObservability:
    DefaultObservability | undefined;
}

export function setupObservability(
  observability: DefaultObservability,
): DefaultObservability;
export function setupObservability(observability: undefined): undefined;
export function setupObservability(
  observability: DefaultObservability | undefined,
): DefaultObservability | undefined {
  globalThis.eventDrivenIoAlmanacDefaultObservability = observability;

  return observability;
}

export const currentDefaultObservability = ():
  DefaultObservability | undefined =>
  globalThis.eventDrivenIoAlmanacDefaultObservability;

export const mergeWithDefaultObservability = (
  parent: DefaultObservability | undefined,
  local: DefaultObservability | undefined,
) =>
  mergeObservability(
    mergeObservability(
      globalThis.eventDrivenIoAlmanacDefaultObservability,
      parent,
    ),
    local,
  );
