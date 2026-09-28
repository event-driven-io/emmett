import { describe, expect, it } from 'vitest';
import { typeIdStreamIdentityCodec } from './streamIdentity';

void describe('typeIdStreamIdentityCodec', () => {
  void it('parses type:id stream names', () => {
    expect(typeIdStreamIdentityCodec.parse('order:123')).toEqual({
      streamType: 'order',
      streamId: '123',
    });
  });

  void it.each(['plain', ':123', 'order:'])(
    'treats %s as unstructured',
    (streamName) => {
      expect(typeIdStreamIdentityCodec.parse(streamName)).toBeUndefined();
    },
  );
});
