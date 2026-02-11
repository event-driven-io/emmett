import { assertEqual } from '@event-driven-io/emmett';
import { describe, it } from 'node:test';
import {
  toMongoDBCheckpoint,
  zipMongoDBMessageBatchPullerStartFrom,
} from './mongoDBCheckpoint';

void describe('zipMongoDBMessageBatchPullerStartFrom', () => {
  void it('it can get the earliest MongoDB oplog token', () => {
    // tokens are sorted in descending order, so the earliest message is at the end
    const input = [
      {
        lastCheckpoint: toMongoDBCheckpoint(
          {
            _data: `82687E94D4000000012B042C0100296E5A100461BBC0449CFA4531AE298EB6083F923A463C6F7065726174696F6E54797065003C7570646174650046646F63756D656E744B65790046645F69640064687E948DC5FE3CA1AF560962000004`,
          },
          1,
        ),
      },
      {
        lastCheckpoint: toMongoDBCheckpoint(
          {
            _data: `82687E949E000000012B042C0100296E5A100461BBC0449CFA4531AE298EB6083F923A463C6F7065726174696F6E54797065003C7570646174650046646F63756D656E744B65790046645F69640064687E948DC5FE3CA1AF560962000004`,
          },
          1,
        ),
      },
      {
        lastCheckpoint: toMongoDBCheckpoint(
          {
            _data: `82687E948D000000032B042C0100296E5A100461BBC0449CFA4531AE298EB6083F923A463C6F7065726174696F6E54797065003C696E736572740046646F63756D656E744B65790046645F69640064687E948DC5FE3CA1AF560962000004`,
          },
          1,
        ),
      },
    ];

    const result = zipMongoDBMessageBatchPullerStartFrom(input);

    assertEqual(input[2], result);
  });
});
