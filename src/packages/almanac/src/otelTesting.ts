import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { SpanStatusCode } from '@opentelemetry/api';

type OtelSpanAssertions = {
  exists(): OtelSpanAssertions;
  hasAttribute(key: string, value: unknown): OtelSpanAssertions;
  hasAttributes(attrs: Record<string, unknown>): OtelSpanAssertions;
  hasParent(ctx: { traceId: string; spanId: string }): OtelSpanAssertions;
  hasNoParent(): OtelSpanAssertions;
  hasStatus(code: SpanStatusCode, message?: string): OtelSpanAssertions;
  hasEvent(name: string): OtelSpanAssertions;
  hasCreationLinks(
    links: { traceId: string; spanId: string }[],
  ): OtelSpanAssertions;
  isMainScope(prefix?: string): OtelSpanAssertions;
};

type OtelSpanCollectionAssertions = {
  haveSpanNamed(name: string): OtelSpanAssertions;
  containSpanNamed(name: string): OtelSpanCollectionAssertions;
  haveNoSpans(): void;
};

export const assertThatOtelSpan = (
  span: ReadableSpan | undefined,
): OtelSpanAssertions => {
  const self: OtelSpanAssertions = {
    exists() {
      if (!span) throw new Error('Expected span to exist but it was not found');
      return self;
    },
    hasAttribute(key, value) {
      if (!span)
        throw new Error(
          `Expected span to have attribute "${key}" but span was not found`,
        );
      const actual = span.attributes[key];
      if (actual !== value)
        throw new Error(
          `Expected span "${span.name}" attribute "${key}" to be ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`,
        );
      return self;
    },
    hasAttributes(attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        self.hasAttribute(key, value);
      }
      return self;
    },
    hasParent(ctx) {
      if (!span)
        throw new Error('Expected span to have parent but span was not found');
      const parent = span.parentSpanContext;
      if (
        !parent ||
        parent.traceId !== ctx.traceId ||
        parent.spanId !== ctx.spanId
      )
        throw new Error(
          `Expected span "${span.name}" to have parent ${JSON.stringify(ctx)}, got ${JSON.stringify(parent)}`,
        );
      return self;
    },
    hasNoParent() {
      if (!span)
        throw new Error(
          'Expected span to have no parent but span was not found',
        );
      if (span.parentSpanContext)
        throw new Error(
          `Expected span "${span.name}" to have no parent, got ${JSON.stringify(span.parentSpanContext)}`,
        );
      return self;
    },
    hasStatus(code, message) {
      if (!span)
        throw new Error('Expected span to have status but span was not found');
      if (span.status.code !== code)
        throw new Error(
          `Expected span "${span.name}" status code to be ${code}, got ${span.status.code}`,
        );
      if (message !== undefined && span.status.message !== message)
        throw new Error(
          `Expected span "${span.name}" status message to be "${message}", got "${span.status.message}"`,
        );
      return self;
    },
    hasEvent(name) {
      if (!span)
        throw new Error('Expected span to have event but span was not found');
      if (!span.events.some((e) => e.name === name))
        throw new Error(
          `Expected span "${span.name}" to have event "${name}", found: [${span.events.map((e) => e.name).join(', ')}]`,
        );
      return self;
    },
    hasCreationLinks(links) {
      if (!span)
        throw new Error('Expected span to have links but span was not found');
      for (const expected of links) {
        const found = span.links.some(
          (l) =>
            l.context.traceId === expected.traceId &&
            l.context.spanId === expected.spanId,
        );
        if (!found)
          throw new Error(
            `Expected span "${span.name}" to have link ${JSON.stringify(expected)}, found: ${JSON.stringify(span.links.map((l) => l.context))}`,
          );
      }
      return self;
    },
    isMainScope(prefix = 'almanac') {
      return self.hasAttribute(`${prefix}.scope.main`, true);
    },
  };
  return self;
};

export const assertThatOtelSpans = (
  spans: ReadableSpan[],
): OtelSpanCollectionAssertions => {
  const self: OtelSpanCollectionAssertions = {
    haveSpanNamed(name) {
      const span = spans.find((s) => s.name === name);
      if (!span)
        throw new Error(
          `Expected span named "${name}" but found: [${spans.map((s) => s.name).join(', ')}]`,
        );
      return assertThatOtelSpan(span);
    },
    containSpanNamed(name) {
      const span = spans.find((s) => s.name === name);
      if (!span)
        throw new Error(
          `Expected span named "${name}" but found: [${spans.map((s) => s.name).join(', ')}]`,
        );
      return self;
    },
    haveNoSpans() {
      if (spans.length > 0)
        throw new Error(
          `Expected no spans but found: [${spans.map((s) => s.name).join(', ')}]`,
        );
    },
  };
  return self;
};
