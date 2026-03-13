import type { ActiveSpan, SpanContext, SpanLink, Tracer } from './tracer';
import { noopSpan } from './tracer';
import type { Meter } from './meter';
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
  meter: Meter;
};

export type ScopeObservability = {
  tracer: Tracer;
  meter: Meter;
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
  meter: observability.meter,
});

const noopScope = (meter: Meter): ObservabilityScope => ({
  setAttributes: () => {},
  scope: async (_name, fn) => fn(noopScope(meter)),
  addEvent: () => {},
  addLink: () => {},
  recordException: () => {},
  spanContext: () => noopSpan.spanContext(),
  meter,
});

export const createScope = (observability: ScopeObservability) => {
  const attrs = scopeAttributes(observability.attributePrefix ?? 'almanac');
  const sampler = observability.sampler ?? alwaysSample;

  return {
    startScope: <T>(
      name: string,
      fn: (scope: ObservabilityScope) => Promise<T>,
      options?: ScopeOptions,
    ): Promise<T> => {
      if (!sampler.shouldSample(name, options?.attributes)) {
        return fn(noopScope(observability.meter));
      }

      return observability.tracer.startSpan(
        name,
        async (rootSpan) => {
          rootSpan.setAttributes({ [attrs.main]: true });
          if (options?.attributes) {
            rootSpan.setAttributes(options.attributes);
          }
          return fn(makeScope(rootSpan, rootSpan, observability));
        },
        {
          attributes: options?.attributes,
          links: options?.links,
          parent: options?.parent,
          propagation: options?.propagation ?? observability.propagation,
        },
      );
    },
  };
};
