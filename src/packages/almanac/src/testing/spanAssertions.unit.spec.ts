import { describe, expect, it } from 'vitest';
import { assertThatSpans } from './spanAssertions';
import type { CollectedSpan } from './collectedSpan';

const span = (
  name: string,
  attributes: Record<string, unknown> = {},
): CollectedSpan => ({
  name,
  attributes,
  logs: [],
  links: [],
  startOptions: {},
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
});
