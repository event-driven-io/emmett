import { describe, expect, it } from 'vitest';
import { typeIdStreamIdentityCodec } from './streamIdentity';

void describe('typeIdStreamIdentityCodec', () => {
  void it('parses the type before the first colon', () => {
    expect(typeIdStreamIdentityCodec.parse('order:region:123')).toEqual({
      streamType: 'order',
      streamId: 'region:123',
    });
  });

  void it.each(['plain', ':123', 'order:'])(
    'treats %s as unstructured',
    (streamName) => {
      expect(typeIdStreamIdentityCodec.parse(streamName)).toBeUndefined();
    },
  );

  void it('formats identities back into names', () => {
    expect(
      typeIdStreamIdentityCodec.format({ streamType: 'order', streamId: '1' }),
    ).toBe('order:1');
  });
});
