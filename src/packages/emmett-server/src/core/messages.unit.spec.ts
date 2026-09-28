import type { Event, ReadEvent } from '@event-driven-io/emmett';
import { describe, expect, it } from 'vitest';
import {
  parseAppendRequest,
  toRecordedMessageRepresentation,
} from './messages';

void describe('toRecordedMessageRepresentation', () => {
  void it('keeps the combined metadata shape with decimal positions', () => {
    const message = {
      type: 'OrderPlaced',
      data: { placedAt: '2026-01-01T00:00:00.000Z' },
      metadata: {
        messageId: 'm1',
        streamName: 'order:1',
        streamPosition: 42n,
        globalPosition: '0000000000000009876',
        checkpoint: '0000000000000009876',
        correlationId: 'c1',
      },
    } as unknown as ReadEvent<Event>;

    expect(toRecordedMessageRepresentation(message)).toEqual({
      kind: 'Event',
      type: 'OrderPlaced',
      data: { placedAt: '2026-01-01T00:00:00.000Z' },
      metadata: {
        messageId: 'm1',
        streamName: 'order:1',
        streamPosition: '42',
        globalPosition: '9876',
        checkpoint: '9876',
        correlationId: 'c1',
      },
    });
  });

  void it('passes non-numeric checkpoints through unchanged', () => {
    const message = {
      type: 'E',
      data: {},
      kind: 'Event',
      metadata: {
        messageId: 'm1',
        streamName: 's',
        streamPosition: 1n,
        checkpoint: '12-34',
      },
    } as unknown as ReadEvent<Event>;

    expect(toRecordedMessageRepresentation(message).metadata.checkpoint).toBe(
      '12-34',
    );
    expect(
      toRecordedMessageRepresentation(message).metadata.globalPosition,
    ).toBe(undefined);
  });
});

void describe('parseAppendRequest', () => {
  void it('defaults the kind to Event', () => {
    expect(
      parseAppendRequest({ messages: [{ type: 'A', data: { a: 1 } }] }),
    ).toEqual({
      ok: true,
      messages: [{ kind: 'Event', type: 'A', data: { a: 1 } }],
    });
  });
});
