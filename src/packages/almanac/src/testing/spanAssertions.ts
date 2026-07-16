import type { TracePropagation } from '../tracers';
import type { CollectedSpan, LoggedEvent } from './collectedSpan';

type SpanAssertions = {
  exists(): SpanAssertions;
  hasAttribute(key: string, value: unknown): SpanAssertions;
  hasAttributes(attrs: Record<string, unknown>): SpanAssertions;
  hasTraceId(traceId: string): SpanAssertions;
  hasParent(ctx: { traceId: string; spanId: string }): SpanAssertions;
  hasNoParent(): SpanAssertions;
  hasPropagation(p: TracePropagation): SpanAssertions;
  hasCreationLinks(
    links: { traceId: string; spanId: string }[],
  ): SpanAssertions;
  logged(
    level: LoggedEvent['metadata']['level'],
    msg?: string,
    partialObj?: Record<string, unknown>,
  ): SpanAssertions;
  loggedCount(n: number): SpanAssertions;
  noLogs(): SpanAssertions;
};

export type SpanCollectionAssertions = {
  hasSingleSpanNamed(name: string): SpanAssertions;
  haveSpansNamed(name: string): SpanGroupAssertions;
  containSpanNamed(name: string): SpanCollectionAssertions;
  haveNoSpans(): void;
};

type SpanGroupAssertions = {
  hasCount(count: number): SpanGroupAssertions;
  haveAttribute(key: string, value: unknown): SpanGroupAssertions;
  haveAttributes(attrs: Record<string, unknown>): SpanGroupAssertions;
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
          `Expected span "${span.name}" attribute "${key}" to be ${JSON.stringify(value)}, got ${JSON.stringify(actual)}.\nExisting attributes: ${JSON.stringify(span.attributes, null, 2)}`,
        );
      return self;
    },
    hasAttributes(attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        self.hasAttribute(key, value);
      }
      return self;
    },
    hasTraceId(traceId) {
      if (!span)
        throw new Error(
          'Expected span to have trace id but span was not found',
        );
      if (span.ownContext.traceId !== traceId)
        throw new Error(
          `Expected span "${span.name}" trace id to be "${traceId}", got "${span.ownContext.traceId}"`,
        );
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
    logged(level, msg, partialObj) {
      if (!span)
        throw new Error('Expected span to have a log but span was not found');
      const match = span.logs.find((r) => {
        if (r.metadata.level !== level) return false;
        if (msg !== undefined && r.data.body !== msg) return false;
        if (partialObj !== undefined) {
          const attributes = r.data.attributes;
          if (!attributes) return false;
          for (const [k, v] of Object.entries(partialObj)) {
            if (JSON.stringify(attributes[k]) !== JSON.stringify(v))
              return false;
          }
        }
        return true;
      });
      if (!match)
        throw new Error(
          `Expected span "${span.name}" to have a "${level}" log${
            msg ? ` with msg "${msg}"` : ''
          }${
            partialObj ? ` and obj ${JSON.stringify(partialObj)}` : ''
          }. Logs: ${JSON.stringify(span.logs, null, 2)}`,
        );
      return self;
    },
    loggedCount(n) {
      if (!span)
        throw new Error('Expected span to have logs but span was not found');
      if (span.logs.length !== n)
        throw new Error(
          `Expected span "${span.name}" to have ${n} log(s) but found ${span.logs.length}. Logs: ${JSON.stringify(span.logs, null, 2)}`,
        );
      return self;
    },
    noLogs() {
      if (!span)
        throw new Error('Expected span to have no logs but span was not found');
      if (span.logs.length > 0)
        throw new Error(
          `Expected span "${span.name}" to have no logs but found ${span.logs.length}. Logs: ${JSON.stringify(span.logs, null, 2)}`,
        );
      return self;
    },
  };
  return self;
};

export const assertThatSpans = (
  spans: CollectedSpan[],
): SpanCollectionAssertions => {
  const self: SpanCollectionAssertions = {
    hasSingleSpanNamed(name) {
      const found = spans.filter((s) => s.name === name);
      if (found.length === 0)
        throw new Error(
          `Expected span named "${name}" but found: [${spans.map((s) => s.name).join(', ')}]`,
        );
      if (found.length > 1)
        throw new Error(
          `Expected exactly one span named "${name}" but found ${found.length}. All spans: [${spans.map((s) => s.name).join(', ')}]`,
        );
      return assertThatSpan(found[0]);
    },
    haveSpansNamed(name) {
      const found = spans.filter((s) => s.name === name);
      const group: SpanGroupAssertions = {
        hasCount(count) {
          if (found.length !== count)
            throw new Error(
              `Expected ${count} span(s) named "${name}" but found ${found.length}. All spans: [${spans.map((s) => s.name).join(', ')}]`,
            );
          return group;
        },
        haveAttribute(key, value) {
          if (found.length === 0)
            throw new Error(
              `Expected span(s) named "${name}" to have attribute "${key}" but none were found. All spans: [${spans.map((s) => s.name).join(', ')}]`,
            );
          for (const span of found) {
            assertThatSpan(span).hasAttribute(key, value);
          }
          return group;
        },
        haveAttributes(attrs) {
          for (const [key, value] of Object.entries(attrs)) {
            group.haveAttribute(key, value);
          }
          return group;
        },
      };
      return group;
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
