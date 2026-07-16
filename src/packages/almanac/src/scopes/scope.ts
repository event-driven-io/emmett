import { scopeAttributes, type AttributeTarget } from '../attributes';
import { alwaysSample, type Sampler } from '../configuration';
import type { LogEvent } from '../loggers';
import { noopLogger } from '../loggers';
import type {
  ActiveSpan,
  Logger,
  SpanContext,
  SpanLink,
  TracePropagation,
  Tracer,
} from '../tracers';
import { noopSpan, noopTracer } from '../tracers';
import { logEventForSpan } from '../tracers/spanLogEvent';

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
  log: Logger;
  addLink(link: SpanLink): void;
  spanContext(): SpanContext;
};

export type ScopeObservability = {
  tracer: Tracer;
  logger?: Logger;
  sampler?: Sampler;
  attributeTarget?: AttributeTarget;
  attributePrefix?: string;
  propagation?: TracePropagation;
};

const hasSpanContext = (context: SpanContext): boolean =>
  context.traceId !== '' && context.spanId !== '';

const logForScope = (
  span: ActiveSpan,
  logger: Logger | undefined,
  event: LogEvent,
): void => {
  if (logger === undefined) {
    span.log(event);
    return;
  }

  const context = span.spanContext();
  logger(hasSpanContext(context) ? logEventForSpan(event, context) : event);
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
  ): Promise<T> => {
    const currentContext = span.spanContext();
    const parent =
      childOpts?.parent ??
      (hasSpanContext(currentContext) ? currentContext : undefined);

    return observability.tracer.startSpan(
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
        parent,
        propagation: childOpts?.propagation ?? observability.propagation,
      },
    );
  },
  log: (event) => logForScope(span, observability.logger, event),
  addLink: (link) => span.addLink(link),
  spanContext: () => span.spanContext(),
});

const makeNoTraceScope = (
  observability: ScopeObservability,
): ObservabilityScope =>
  makeScope(noopSpan, noopSpan, { ...observability, tracer: noopTracer() });

export const noopScope: ObservabilityScope = {
  setAttributes: () => {},
  scope: async (_name, fn) => fn(noopScope),
  log: noopLogger,
  addLink: () => {},
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
        return fn(makeNoTraceScope(observability));
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
