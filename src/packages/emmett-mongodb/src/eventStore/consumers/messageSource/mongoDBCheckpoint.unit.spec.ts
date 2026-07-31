import { ProcessorCheckpoint, assertEqual } from '@event-driven-io/emmett';
import { describe, it } from 'vitest';
import {
  toMongoDBCheckpoint,
  toMongoDBResumeToken,
  type MongoDBResumeToken,
} from './mongoDBCheckpoint';

const earlierToken: MongoDBResumeToken = {
  _data: `82687E948D000000032B042C0100296E5A100461BBC0449CFA4531AE298EB6083F923A463C6F7065726174696F6E54797065003C696E736572740046646F63756D656E744B65790046645F69640064687E948DC5FE3CA1AF560962000004`,
};
const laterToken: MongoDBResumeToken = {
  _data: `82687E94D4000000012B042C0100296E5A100461BBC0449CFA4531AE298EB6083F923A463C6F7065726174696F6E54797065003C7570646174650046646F63756D656E744B65790046645F69640064687E948DC5FE3CA1AF560962000004`,
};

void describe('MongoDB checkpoint', () => {
  void it('orders checkpoints by resume token with the default comparator', () => {
    assertEqual(
      -1,
      ProcessorCheckpoint.compare(
        toMongoDBCheckpoint(earlierToken, 0),
        toMongoDBCheckpoint(laterToken, 0),
      ),
    );
  });

  void it('orders checkpoints of the same change by message position with the default comparator', () => {
    assertEqual(
      -1,
      ProcessorCheckpoint.compare(
        toMongoDBCheckpoint(earlierToken, 9),
        toMongoDBCheckpoint(earlierToken, 10),
      ),
    );
  });

  void it('treats the resume token as more significant than the message position', () => {
    assertEqual(
      -1,
      ProcessorCheckpoint.compare(
        toMongoDBCheckpoint(earlierToken, 100),
        toMongoDBCheckpoint(laterToken, 0),
      ),
    );
  });

  void it('round trips the resume token', () => {
    assertEqual(
      laterToken._data,
      toMongoDBResumeToken(toMongoDBCheckpoint(laterToken, 10))._data,
    );
  });
});
