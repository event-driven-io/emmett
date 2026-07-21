import { scopeAttributes, type AttributeTarget } from '../attributes';
import { alwaysSample, type Sampler } from '../configuration';
import type { LogEvent } from '../loggers';
import type {
  ActiveSpan,
  Logger,
  ObservabilityContextGenerator,
  SpanContext,
  SpanLink,
  TracePropagation,
  Tracer,
} from '../tracers';
import {
  defaultObservabilityContextGenerator,
  noopSpan,
  noopTracer,
} from '../tracers';
import { logEventForSpan } from '../tracers/spanLogEvent';

export type SetAttributesOptions = {
  target?: AttributeTarget;
};

/**
 * The message-flow context an operation carries alongside its span:
 * `correlationId` groups a whole flow, `causationId` names the direct cause.
 * Used to *seed* a scope; the scope resolves it into the full
 * {@link ObservabilityContext}.
 */
export type MessageContext = {
  correlationId?: string;
  causationId?: string;
};

/**
 * The full observability context a scope carries: trace/span identify the
 * operation, correlation/causation trace the message flow. All four are the
 * same kind of data, read through one accessor: trace/span come from the
 * scope's span, correlation/causation from the context it carries; anything
 * absent is filled by the generator.
 */
export type ObservabilityContext = {
  traceId: string;
  spanId: string;
  correlationId: string;
  causationId?: string;
};

export type ScopeOptions = {
  attributes?: Record<string, unknown>;
  links?: SpanLink[];
  parent?: SpanContext;
  propagation?: TracePropagation;
  context?: MessageContext;
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
  /** The resolved observability context this scope carries (inherited by children). */
  context: ObservabilityContext;
};

export type ScopeObservability = {
  tracer: Tracer;
  logger?: Logger;
  sampler?: Sampler;
  attributeTarget?: AttributeTarget;
  attributePrefix?: string;
  propagation?: TracePropagation;
  contextGenerator?: ObservabilityContextGenerator;
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
  inherited: Partial<ObservabilityContext> = {},
): ObservabilityScope => {
  const generator =
    observability.contextGenerator ?? defaultObservabilityContextGenerator;
  const spanContext = span.spanContext();
  // The four ids resolve the same way: trace/span come from this scope's span
  // (a child always mints its own), correlation/causation from the inherited
  // context; anything absent is generated once and inherited by children.
  const context: ObservabilityContext = {
    traceId:
      spanContext.traceId || inherited.traceId || generator.generateTraceId(),
    spanId: spanContext.spanId || generator.generateSpanId(),
    correlationId: inherited.correlationId ?? generator.generateCorrelationId(),
    causationId: inherited.causationId,
  };

  return {
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
      const childContext: Partial<ObservabilityContext> = {
        ...context,
        ...childOpts?.context,
      };

      return observability.tracer.startSpan(
        childName,
        async (childSpan) => {
          if (childOpts?.attributes) {
            childSpan.setAttributes(childOpts.attributes);
          }
          return childFn(
            makeScope(childSpan, root, observability, childContext),
          );
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
    context,
  };
};

const makeNoTraceScope = (
  observability: ScopeObservability,
  context: MessageContext = {},
): ObservabilityScope =>
  makeScope(
    noopSpan,
    noopSpan,
    { ...observability, tracer: noopTracer() },
    context,
  );

export const noopScope: ObservabilityScope = makeNoTraceScope({
  tracer: noopTracer(),
  contextGenerator: defaultObservabilityContextGenerator,
});

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
        return fn(makeNoTraceScope(observability, options?.context));
      }

      return observability.tracer.startSpan(
        name,
        async (rootSpan) => {
          rootSpan.setAttributes({ [attrs.main]: true });
          if (Object.keys(mergedAttrs).length > 0) {
            rootSpan.setAttributes(mergedAttrs);
          }
          return fn(
            makeScope(rootSpan, rootSpan, observability, options?.context),
          );
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
