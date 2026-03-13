import type { ActiveSpan, SpanContext, SpanLink, Tracer } from './tracer';
import { noopSpan } from './tracer';
import type { Sampler, TracePropagation, AttributeTarget } from './options';
import { alwaysSample } from './options';
import { scopeAttributes } from './attributes';

export type SetAttributesOptions = {
  target?: AttributeTarget;
};

export type ScopeOptions = {
  attributes?: Record<string, unknown>;
  links?: SpanLink[];
  parent?: SpanContext;
  propagation?: TracePropagation;
};

export type ObservabilityScope = {
  setAttributes(
    attrs: Record<string, unknown>,
    options?: SetAttributesOptions,
  ): void;
  scope<T>(
    name: string,
    fn: (child: ObservabilityScope) => Promise<T>,
    options?: ScopeOptions,
  ): Promise<T>;
  addEvent(name: string, attributes?: Record<string, unknown>): void;
  addLink(link: SpanLink): void;
  recordException(error: Error | string): void;
  spanContext(): SpanContext;
};

export type ScopeObservability = {
  tracer: Tracer;
  sampler?: Sampler;
  attributeTarget?: AttributeTarget;
  attributePrefix?: string;
  propagation?: TracePropagation;
};

const makeScope = (
  span: ActiveSpan,
  root: ActiveSpan,
  observability: ScopeObservability,
): ObservabilityScope => ({
  setAttributes: (attrs, opts?) => {
    if (span === root) {
      root.setAttributes(attrs);
      return;
    }
    const target = opts?.target ?? observability.attributeTarget ?? 'both';
    if (target === 'mainSpan' || target === 'both') {
      root.setAttributes(attrs);
    }
    if (target === 'currentSpan' || target === 'both') {
      span.setAttributes(attrs);
    }
  },
  scope: <T>(
    childName: string,
    childFn: (child: ObservabilityScope) => Promise<T>,
    childOpts?: ScopeOptions,
  ): Promise<T> =>
    observability.tracer.startSpan(
      childName,
      async (childSpan) => {
        if (childOpts?.attributes) {
          childSpan.setAttributes(childOpts.attributes);
        }
        return childFn(makeScope(childSpan, root, observability));
      },
      {
        attributes: childOpts?.attributes,
        links: childOpts?.links,
        parent: childOpts?.parent,
        propagation: childOpts?.propagation ?? observability.propagation,
      },
    ),
  addEvent: (name, attributes) => span.addEvent(name, attributes),
  addLink: (link) => span.addLink(link),
  recordException: (error) => span.recordException(error),
  spanContext: () => span.spanContext(),
});

const noopScope: ObservabilityScope = {
  setAttributes: () => {},
  scope: async (_name, fn) => fn(noopScope),
  addEvent: () => {},
  addLink: () => {},
  recordException: () => {},
  spanContext: () => noopSpan.spanContext(),
};

export const ObservabilityScope = (
  observability: ScopeObservability,
  factoryOptions?: { defaultAttributes?: Record<string, unknown> },
) => {
  const attrs = scopeAttributes(observability.attributePrefix ?? 'almanac');
  const sampler = observability.sampler ?? alwaysSample;
  const defaultAttrs = factoryOptions?.defaultAttributes ?? {};

  return {
    startScope: <T>(
      name: string,
      fn: (scope: ObservabilityScope) => Promise<T>,
      options?: ScopeOptions,
    ): Promise<T> => {
      const mergedAttrs = { ...defaultAttrs, ...(options?.attributes ?? {}) };

      if (!sampler.shouldSample(name, mergedAttrs)) {
        return fn(noopScope);
      }

      return observability.tracer.startSpan(
        name,
        async (rootSpan) => {
          rootSpan.setAttributes({ [attrs.main]: true });
          if (Object.keys(mergedAttrs).length > 0) {
            rootSpan.setAttributes(mergedAttrs);
          }
          return fn(makeScope(rootSpan, rootSpan, observability));
        },
        {
          attributes: mergedAttrs,
          links: options?.links,
          parent: options?.parent,
          propagation: options?.propagation ?? observability.propagation,
        },
      );
    },
  };
};
