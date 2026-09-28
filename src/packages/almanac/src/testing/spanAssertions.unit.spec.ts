import { describe, expect, it } from 'vitest';
import { assertThatSpans } from './spanAssertions';
import type { CollectedSpan } from './collectedSpan';

const span = (
  name: string,
  attributes: Record<string, unknown> = {},
  parent?: { traceId: string; spanId: string },
): CollectedSpan => ({
  name,
  attributes,
  logs: [],
  links: [],
  startOptions: parent ? { parent } : {},
  ownContext: { traceId: 'trace', spanId: name },
});

describe('spanAssertions', () => {
  it('asserts a single span by name', () => {
    assertThatSpans([
      span('eventStore.readStream', {
        'eventStore.operation': 'readStream',
      }),
      span('eventStore.aggregateStream'),
    ])
      .hasSingleSpanNamed('eventStore.readStream')
      .hasAttributes({
        'eventStore.operation': 'readStream',
      });
  });

  it('throws when single span assertion matches multiple spans', () => {
    expect(() =>
      assertThatSpans([
        span('eventStore.readStream'),
        span('eventStore.readStream'),
      ]).hasSingleSpanNamed('eventStore.readStream'),
    ).toThrow('Expected exactly one span named "eventStore.readStream"');
  });

  it('asserts span counts by name', () => {
    assertThatSpans([
      span('eventStore.readStream'),
      span('eventStore.readStream'),
      span('eventStore.aggregateStream'),
    ])
      .haveSpansNamed('eventStore.readStream')
      .hasCount(2);
  });

  it('throws when span count does not match', () => {
    expect(() =>
      assertThatSpans([span('eventStore.readStream')])
        .haveSpansNamed('eventStore.readStream')
        .hasCount(2),
    ).toThrow('Expected 2 span(s) named "eventStore.readStream"');
  });

  it('asserts attributes on all spans with the same name', () => {
    assertThatSpans([
      span('eventStore.readStream', {
        'eventStore.operation': 'readStream',
      }),
      span('eventStore.readStream', {
        'eventStore.operation': 'readStream',
      }),
      span('eventStore.aggregateStream', {
        'eventStore.operation': 'aggregateStream',
      }),
    ])
      .haveSpansNamed('eventStore.readStream')
      .hasCount(2)
      .haveAttributes({
        'eventStore.operation': 'readStream',
      });
  });

  it('asserts parent span by name on all spans with the same name', () => {
    const parent = span('command.handle');
    const parentContext = {
      traceId: parent.ownContext.traceId,
      spanId: parent.ownContext.spanId,
    };

    assertThatSpans([
      parent,
      span('eventStore.aggregateStream', {}, parentContext),
      span('eventStore.aggregateStream', {}, parentContext),
    ])
      .haveSpansNamed('eventStore.aggregateStream')
      .hasCount(2)
      .haveParentSpanNamed('command.handle');
  });

  it('throws when any grouped span does not have the expected parent span', () => {
    const parent = span('command.handle');
    const parentContext = {
      traceId: parent.ownContext.traceId,
      spanId: parent.ownContext.spanId,
    };

    expect(() =>
      assertThatSpans([
        parent,
        span('eventStore.aggregateStream', {}, parentContext),
        span('eventStore.aggregateStream'),
      ])
        .haveSpansNamed('eventStore.aggregateStream')
        .haveParentSpanNamed('command.handle'),
    ).toThrow('Expected span "eventStore.aggregateStream" to have parent');
  });

  it('throws when any span with the same name misses expected attributes', () => {
    expect(() =>
      assertThatSpans([
        span('eventStore.readStream', {
          'eventStore.operation': 'readStream',
        }),
        span('eventStore.readStream', {
          'eventStore.operation': 'appendToStream',
        }),
      ])
        .haveSpansNamed('eventStore.readStream')
        .haveAttributes({
          'eventStore.operation': 'readStream',
        }),
    ).toThrow(
      'Expected span "eventStore.readStream" attribute "eventStore.operation" to be "readStream"',
    );
  });

  it('throws when grouped attribute assertions have no matching spans', () => {
    expect(() =>
      assertThatSpans([span('eventStore.aggregateStream')])
        .haveSpansNamed('eventStore.readStream')
        .haveAttribute('eventStore.operation', 'readStream'),
    ).toThrow(
      'Expected span(s) named "eventStore.readStream" to have attribute "eventStore.operation" but none were found',
    );
  });

  it('asserts span trace id', () => {
    assertThatSpans([span('eventStore.inlineProjection')])
      .hasSingleSpanNamed('eventStore.inlineProjection')
      .hasTraceId('trace');
  });

  it('asserts parent span by name', () => {
    assertThatSpans([
      span('eventStore.appendToStream'),
      span(
        'eventStore.inlineProjection',
        {},
        {
          traceId: 'trace',
          spanId: 'eventStore.appendToStream',
        },
      ),
    ])
      .hasSingleSpanNamed('eventStore.inlineProjection')
      .hasParentSpanNamed('eventStore.appendToStream');
  });

  it('asserts child span by name', () => {
    assertThatSpans([
      span('eventStore.appendToStream'),
      span(
        'eventStore.inlineProjection',
        { 'eventStore.operation': 'inlineProjection' },
        {
          traceId: 'trace',
          spanId: 'eventStore.appendToStream',
        },
      ),
    ])
      .hasSingleSpanNamed('eventStore.appendToStream')
      .hasChildNamed('eventStore.inlineProjection')
      .hasAttribute('eventStore.operation', 'inlineProjection');
  });

  it('throws when child span is missing', () => {
    expect(() =>
      assertThatSpans([span('eventStore.appendToStream')])
        .hasSingleSpanNamed('eventStore.appendToStream')
        .hasChildNamed('eventStore.inlineProjection'),
    ).toThrow(
      'Expected span "eventStore.appendToStream" to have child span named "eventStore.inlineProjection"',
    );
  });

  it('throws when multiple child spans match', () => {
    const parent = span('eventStore.appendToStream');
    const childParent = {
      traceId: parent.ownContext.traceId,
      spanId: parent.ownContext.spanId,
    };

    expect(() =>
      assertThatSpans([
        parent,
        span('eventStore.inlineProjection', {}, childParent),
        span('eventStore.inlineProjection', {}, childParent),
      ])
        .hasSingleSpanNamed('eventStore.appendToStream')
        .hasChildNamed('eventStore.inlineProjection'),
    ).toThrow(
      'Expected span "eventStore.appendToStream" to have exactly one child span named "eventStore.inlineProjection"',
    );
  });

  it('filters single span by parent span name', () => {
    assertThatSpans([
      span('eventStore.readStream'),
      span('eventStore.aggregateStream'),
      span(
        'eventStore.readStream',
        {},
        {
          traceId: 'trace',
          spanId: 'eventStore.aggregateStream',
        },
      ),
    ]).hasSingleSpanNamed('eventStore.readStream', {
      parentSpanNamed: 'eventStore.aggregateStream',
    });
  });

  it('asserts a span failed with the given error', () => {
    const failure = new Error('boom');

    assertThatSpans([{ ...span('failed'), error: failure }])
      .hasSingleSpanNamed('failed')
      .hasError(failure);
  });

  it('throws when a span expected to fail has no error', () => {
    expect(() =>
      assertThatSpans([span('ok')])
        .hasSingleSpanNamed('ok')
        .hasError(),
    ).toThrow('Expected span "ok" to have failed');
  });

  it('throws when a span failed with a different error', () => {
    expect(() =>
      assertThatSpans([{ ...span('failed'), error: new Error('other') }])
        .hasSingleSpanNamed('failed')
        .hasError(new Error('boom')),
    ).toThrow('Expected span "failed" to have failed with');
  });

  it('asserts a span did not fail', () => {
    assertThatSpans([span('ok')])
      .hasSingleSpanNamed('ok')
      .hasNoError();
  });

  it('throws when a span expected not to fail has an error', () => {
    expect(() =>
      assertThatSpans([{ ...span('failed'), error: new Error('boom') }])
        .hasSingleSpanNamed('failed')
        .hasNoError(),
    ).toThrow('Expected span "failed" not to have failed');
  });
});
