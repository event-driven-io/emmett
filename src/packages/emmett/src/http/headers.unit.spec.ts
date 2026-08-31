import { describe, it } from 'vitest';
import { assertEqual } from '../testing';
import { HeaderNames } from './headers';

void describe('HeaderNames', () => {
  void it('uses the header names defined by RFC 9110', () => {
    assertEqual('if-match', HeaderNames.IF_MATCH);
    assertEqual('if-none-match', HeaderNames.IF_NONE_MATCH);
    assertEqual('etag', HeaderNames.ETag);
  });

  void it('keeps IF_NOT_MATCH as an alias with the corrected value', () => {
    assertEqual('if-none-match', HeaderNames.IF_NOT_MATCH);
  });
});
