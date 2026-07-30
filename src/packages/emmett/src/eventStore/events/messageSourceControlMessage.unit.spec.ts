import { describe, it } from 'vitest';
import { getCheckpoint, ProcessorCheckpoint } from '../../processors';
import { assertEqual, assertFalse, assertTrue } from '../../testing';
import type { RecordedMessage } from '../../typing';
import { MessageSourceCaughtUp, MessageSourceControlMessage } from './';

const checkpoint = ProcessorCheckpoint('7');

const recorded = {
  type: 'Recorded',
  kind: 'Event',
  data: {},
  metadata: {
    messageId: 'message-1',
    streamPosition: 1n,
    streamName: 'stream-1',
    checkpoint: ProcessorCheckpoint('1'),
  },
} as RecordedMessage;

void describe('MessageSourceCaughtUp', () => {
  void it('reports its checkpoint where every other message does', () => {
    const caughtUp = MessageSourceCaughtUp(checkpoint);

    assertEqual(
      getCheckpoint(caughtUp as unknown as RecordedMessage),
      checkpoint,
    );
    assertEqual(caughtUp.data.checkpoint, checkpoint);
  });

  void it('recognises itself and nothing else', () => {
    assertTrue(MessageSourceCaughtUp.is(MessageSourceCaughtUp(checkpoint)));
    assertFalse(MessageSourceCaughtUp.is(recorded));
  });
});

void describe('MessageSourceControlMessage', () => {
  void it('is every message a source sends about itself', () => {
    const caughtUp = MessageSourceCaughtUp(checkpoint);

    assertTrue(MessageSourceControlMessage.is(caughtUp));
    assertFalse(MessageSourceControlMessage.isNot(caughtUp));
  });

  void it('is not a recorded message', () => {
    assertFalse(MessageSourceControlMessage.is(recorded));
    assertTrue(MessageSourceControlMessage.isNot(recorded));
  });
});
