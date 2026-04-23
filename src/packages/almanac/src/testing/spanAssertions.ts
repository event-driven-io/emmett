import type { TracePropagation } from '../tracers';
import type { CollectedSpan } from './collectedSpan';

type SpanAssertions = {
  exists(): SpanAssertions;
  hasAttribute(key: string, value: unknown): SpanAssertions;
  hasAttributes(attrs: Record<string, unknown>): SpanAssertions;
  hasParent(ctx: { traceId: string; spanId: string }): SpanAssertions;
  hasNoParent(): SpanAssertions;
  hasPropagation(p: TracePropagation): SpanAssertions;
  hasCreationLinks(
    links: { traceId: string; spanId: string }[],
  ): SpanAssertions;
};

export type SpanCollectionAssertions = {
  haveSpanNamed(name: string): SpanAssertions;
  containSpanNamed(name: string): SpanCollectionAssertions;
  haveNoSpans(): void;
};

export const assertThatSpan = (
  span: CollectedSpan | undefined,
): SpanAssertions => {
  const self: SpanAssertions = {
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
      const isEqual =
        Array.isArray(value) || (typeof value === 'object' && value !== null)
          ? JSON.stringify(actual) === JSON.stringify(value)
          : actual === value;
      if (!isEqual)
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
      const parent = span.startOptions.parent;
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
      if (span.startOptions.parent)
        throw new Error(
          `Expected span "${span.name}" to have no parent, got ${JSON.stringify(span.startOptions.parent)}`,
        );
      return self;
    },
    hasPropagation(p) {
      if (!span)
        throw new Error(
          `Expected span to have propagation "${p}" but span was not found`,
        );
      if (span.startOptions.propagation !== p)
        throw new Error(
          `Expected span "${span.name}" propagation to be "${p}", got "${span.startOptions.propagation}"`,
        );
      return self;
    },
    hasCreationLinks(links) {
      if (!span)
        throw new Error(
          'Expected span to have creation links but span was not found',
        );
      const actual = span.startOptions.links ?? [];
      for (const expected of links) {
        const found = actual.some(
          (l) => l.traceId === expected.traceId && l.spanId === expected.spanId,
        );
        if (!found)
          throw new Error(
            `Expected span "${span.name}" to have creation link ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
          );
      }
      return self;
    },
  };
  return self;
};

export const assertThatSpans = (
  spans: CollectedSpan[],
): SpanCollectionAssertions => {
  const self: SpanCollectionAssertions = {
    haveSpanNamed(name) {
      const span = spans.find((s) => s.name === name);
      if (!span)
        throw new Error(
          `Expected span named "${name}" but found: [${spans.map((s) => s.name).join(', ')}]`,
        );
      return assertThatSpan(span);
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
