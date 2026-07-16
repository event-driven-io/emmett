import type {
  Observability,
  ObservabilityScope,
  ScopeOptions,
} from '@event-driven-io/almanac';

export type WithObservabilityScope<Context> = Context & {
  observabilityScope: ObservabilityScope;
};

export type OperationObservabilityOptions =
  | (ScopeOptions & { scope?: never })
  | (Omit<ScopeOptions, 'parent'> & {
      scope: ObservabilityScope;
      parent?: never;
    });

export const withOperationAttributes = (
  options: OperationObservabilityOptions | undefined,
  attributes: Record<string, unknown>,
): OperationObservabilityOptions => {
  if (options?.scope) {
    return {
      ...options,
      attributes: {
        ...(options.attributes ?? {}),
        ...attributes,
      },
    };
  }

  return {
    ...(options ?? {}),
    attributes: {
      ...(options?.attributes ?? {}),
      ...attributes,
    },
  };
};

export const withOperationScope = (
  scope: ObservabilityScope,
  options?: OperationObservabilityOptions,
): OperationObservabilityOptions => {
  if (!options) return { scope };

  const { parent: _parent, scope: _scope, ...scopeOptions } = options;

  return {
    ...scopeOptions,
    scope,
  };
};

export type PollTracing = 'off' | 'active' | 'verbose';

export type EmmettObservabilityConfig = Partial<Observability<'emmett'>> & {
  pollTracing?: PollTracing;
  includeMessagePayloads?: boolean;
};
