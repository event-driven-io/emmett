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
});
