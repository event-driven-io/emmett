import { JSONSerializer } from '../../serialization/json';
import type { SpanStatusCode } from '@opentelemetry/api';
import type { SeverityNumber } from '@opentelemetry/api-logs';
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

type OtelSpanAssertions = {
  exists(): OtelSpanAssertions;
  hasAttribute(key: string, value: unknown): OtelSpanAssertions;
  hasAttributes(attrs: Record<string, unknown>): OtelSpanAssertions;
  hasParent(ctx: { traceId: string; spanId: string }): OtelSpanAssertions;
  hasParentSpanNamed(name: string): OtelSpanAssertions;
  hasChildNamed(name: string): OtelSpanAssertions;
  hasNoParent(): OtelSpanAssertions;
  hasStatus(code: SpanStatusCode, message?: string): OtelSpanAssertions;
  hasCreationLinks(
    links: { traceId: string; spanId: string }[],
  ): OtelSpanAssertions;
  isMainScope(prefix?: string): OtelSpanAssertions;
};

type SingleOtelSpanFilter = {
  parentSpanNamed?: string;
  noParent?: boolean;
};

type OtelSpanCollectionAssertions = {
  hasSingleSpanNamed(
    name: string,
    filter?: SingleOtelSpanFilter,
  ): OtelSpanAssertions;
  haveSpansNamed(name: string): OtelSpanGroupAssertions;
  containSpanNamed(name: string): OtelSpanCollectionAssertions;
  haveNoSpans(): void;
};

type OtelSpanGroupAssertions = {
  hasCount(count: number): OtelSpanGroupAssertions;
  haveAttribute(key: string, value: unknown): OtelSpanGroupAssertions;
  haveAttributes(attrs: Record<string, unknown>): OtelSpanGroupAssertions;
};

const otelSpan = (
  span: ReadableSpan | undefined,
  spans: ReadableSpan[] = span ? [span] : [],
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
    hasParentSpanNamed(name) {
      const parents = spans.filter((s) => s.name === name);
      if (parents.length === 0)
        throw new Error(
          `Expected parent span named "${name}" but found: [${spans.map((s) => s.name).join(', ')}]`,
        );
      if (parents.length > 1)
        throw new Error(
          `Expected exactly one parent span named "${name}" but found ${parents.length}. All spans: [${spans.map((s) => s.name).join(', ')}]`,
        );
      const parent = parents[0]!.spanContext();
      return self.hasParent({
        traceId: parent.traceId,
        spanId: parent.spanId,
      });
    },
    hasChildNamed(name) {
      if (!span)
        throw new Error('Expected span to have child but span was not found');
      const parent = span.spanContext();
      const children = spans.filter(
        (s) =>
          s.name === name &&
          s.parentSpanContext?.traceId === parent.traceId &&
          s.parentSpanContext?.spanId === parent.spanId,
      );
      if (children.length === 0)
        throw new Error(
          `Expected span "${span.name}" to have child span named "${name}" but found: [${spans.map((s) => s.name).join(', ')}]`,
        );
      if (children.length > 1)
        throw new Error(
          `Expected span "${span.name}" to have exactly one child span named "${name}" but found ${children.length}. All spans: [${spans.map((s) => s.name).join(', ')}]`,
        );
      return otelSpan(children[0], spans);
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

const otelSpans = (spans: ReadableSpan[]): OtelSpanCollectionAssertions => {
  const findSingleParent = (name: string): ReadableSpan => {
    const parents = spans.filter((s) => s.name === name);
    if (parents.length === 0)
      throw new Error(
        `Expected parent span named "${name}" but found: [${spans.map((s) => s.name).join(', ')}]`,
      );
    if (parents.length > 1)
      throw new Error(
        `Expected exactly one parent span named "${name}" but found ${parents.length}. All spans: [${spans.map((s) => s.name).join(', ')}]`,
      );
    return parents[0]!;
  };
  const self: OtelSpanCollectionAssertions = {
    hasSingleSpanNamed(name, filter) {
      const parent = filter?.parentSpanNamed
        ? findSingleParent(filter.parentSpanNamed)
        : undefined;
      const parentContext = parent?.spanContext();
      const found = spans.filter((s) => {
        if (s.name !== name) return false;
        if (parentContext) {
          return (
            s.parentSpanContext?.traceId === parentContext.traceId &&
            s.parentSpanContext?.spanId === parentContext.spanId
          );
        }
        if (filter?.noParent) return s.parentSpanContext === undefined;
        return true;
      });
      if (found.length === 0)
        throw new Error(
          `Expected span named "${name}" but found: [${spans.map((s) => s.name).join(', ')}]`,
        );
      if (found.length > 1)
        throw new Error(
          `Expected exactly one span named "${name}" but found ${found.length}. All spans: [${spans.map((s) => s.name).join(', ')}]`,
        );
      return otelSpan(found[0], spans);
    },
    haveSpansNamed(name) {
      const found = spans.filter((s) => s.name === name);
      const group: OtelSpanGroupAssertions = {
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
            otelSpan(span, spans).hasAttribute(key, value);
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

type OtelLogAssertions = {
  exists(): OtelLogAssertions;
  hasEventName(name: string): OtelLogAssertions;
  hasBody(body: unknown): OtelLogAssertions;
  hasSeverity(severityNumber: SeverityNumber): OtelLogAssertions;
  hasAttribute(key: string, value: unknown): OtelLogAssertions;
  hasAttributes(attrs: Record<string, unknown>): OtelLogAssertions;
  hasSpanContext(ctx: { traceId: string; spanId: string }): OtelLogAssertions;
};

type OtelLogCollectionAssertions = {
  haveLogNamed(eventName: string): OtelLogAssertions;
  haveLogWithBody(body: string): OtelLogAssertions;
  haveNoLogs(): void;
};

const otelLog = (log: ReadableLogRecord | undefined): OtelLogAssertions => {
  const self: OtelLogAssertions = {
    exists() {
      if (!log) throw new Error('Expected log to exist but it was not found');
      return self;
    },
    hasEventName(name) {
      self.exists();
      if (log!.eventName !== name)
        throw new Error(
          `Expected log event name to be "${name}", got "${log!.eventName}"`,
        );
      return self;
    },
    hasBody(body) {
      self.exists();
      if (log!.body !== body)
        throw new Error(
          `Expected log body to be ${JSON.stringify(body)}, got ${JSON.stringify(log!.body)}`,
        );
      return self;
    },
    hasSeverity(severityNumber) {
      self.exists();
      if (log!.severityNumber !== severityNumber)
        throw new Error(
          `Expected log severityNumber to be ${severityNumber}, got ${log!.severityNumber}`,
        );
      return self;
    },
    hasAttribute(key, value) {
      self.exists();
      const actual = log!.attributes[key];
      if (actual !== value)
        throw new Error(
          `Expected log attribute "${key}" to be ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`,
        );
      return self;
    },
    hasAttributes(attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        self.hasAttribute(key, value);
      }
      return self;
    },
    hasSpanContext(ctx) {
      self.exists();
      const sc = log!.spanContext;
      if (!sc || sc.traceId !== ctx.traceId || sc.spanId !== ctx.spanId)
        throw new Error(
          `Expected log span context to be ${JSON.stringify(ctx)}, got ${JSON.stringify(sc && { traceId: sc.traceId, spanId: sc.spanId })}`,
        );
      return self;
    },
  };
  return self;
};

const otelLogs = (logs: ReadableLogRecord[]): OtelLogCollectionAssertions => {
  const self: OtelLogCollectionAssertions = {
    haveLogNamed(eventName) {
      const log = logs.find((r) => r.eventName === eventName);
      if (!log)
        throw new Error(
          `Expected log named "${eventName}" but found: [${logs.map((r) => r.eventName ?? '<unnamed>').join(', ')}]`,
        );
      return otelLog(log);
    },
    haveLogWithBody(body) {
      const log = logs.find((r) => r.body === body);
      if (!log)
        throw new Error(
          `Expected log with body "${body}" but found: [${logs.map((r) => JSONSerializer.serialize(r.body, { safe: true })).join(', ')}]`,
        );
      return otelLog(log);
    },
    haveNoLogs() {
      if (logs.length > 0)
        throw new Error(
          `Expected no logs but found: [${logs.map((r) => r.eventName ?? JSONSerializer.serialize(r.body, { safe: true })).join(', ')}]`,
        );
    },
  };
  return self;
};

export const otelAssertions = {
  span: otelSpan,
  spans: otelSpans,
  log: otelLog,
  logs: otelLogs,
};
