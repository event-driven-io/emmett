import { assertEqual, type Event } from '@event-driven-io/emmett';
import { describe, it } from 'vitest';
import { oplogChangeToTailCheckpoint, type FullDocument } from './index';
import { toMongoDBCheckpoint } from './mongoDBCheckpoint';

void describe('readLastCommittedMessageCheckpoint', () => {
  void it('maps a multi-message change to the checkpoint of the last message', () => {
    const resumeToken = { _data: '010203' };
    const change = {
      _id: resumeToken,
      operationType: 'insert',
      fullDocument: {
        streamName: 'guestStay-1',
        messages: [
          { type: 'GuestCheckedIn', data: { guestId: '1' }, metadata: {} },
          { type: 'GuestCheckedOut', data: { guestId: '1' }, metadata: {} },
        ],
      },
    } as unknown as FullDocument<Event>;

    assertEqual(
      toMongoDBCheckpoint(resumeToken, 1),
      oplogChangeToTailCheckpoint(change),
    );
  });
});
