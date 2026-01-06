import { describe, it } from 'node:test';
import { assertFalse, assertOk, assertTrue } from '../../testing';
import { hashText } from './hashText';

void describe('hashText', () => {
  void describe('basic functionality', () => {
    void it('returns a bigint', async () => {
      const result = await hashText('hello');
      assertOk(typeof result === 'bigint');
    });

    void it('returns a positive bigint', async () => {
      const result = await hashText('hello');
      assertTrue(result >= 0n);
    });

    void it('returns consistent hash for same input', async () => {
      const result1 = await hashText('hello');
      const result2 = await hashText('hello');
      assertTrue(result1 === result2);
    });

    void it('returns different hash for different input', async () => {
      const result1 = await hashText('hello');
      const result2 = await hashText('world');
      assertFalse(result1 === result2);
    });
  });

  void describe('empty and whitespace strings', () => {
    void it('handles empty string', async () => {
      const result = await hashText('');
      assertOk(typeof result === 'bigint');
    });

    void it('returns consistent hash for empty string', async () => {
      const result1 = await hashText('');
      const result2 = await hashText('');
      assertTrue(result1 === result2);
    });

    void it('handles whitespace strings', async () => {
      const result1 = await hashText(' ');
      const result2 = await hashText('  ');
      const result3 = await hashText('\t');
      const result4 = await hashText('\n');

      assertFalse(result1 === result2);
      assertFalse(result1 === result3);
      assertFalse(result1 === result4);
    });

    void it('treats whitespace as different from empty', async () => {
      const emptyResult = await hashText('');
      const spaceResult = await hashText(' ');
      assertFalse(emptyResult === spaceResult);
    });
  });

  void describe('unicode handling', () => {
    void it('handles unicode characters', async () => {
      const result = await hashText('🚀');
      assertOk(typeof result === 'bigint');
    });

    void it('returns consistent hash for unicode', async () => {
      const result1 = await hashText('🚀🎉');
      const result2 = await hashText('🚀🎉');
      assertTrue(result1 === result2);
    });

    void it('returns different hash for different unicode', async () => {
      const result1 = await hashText('🚀');
      const result2 = await hashText('🎉');
      assertFalse(result1 === result2);
    });

    void it('handles mixed ascii and unicode', async () => {
      const result1 = await hashText('hello🚀');
      const result2 = await hashText('hello🚀');
      const result3 = await hashText('🚀hello');

      assertTrue(result1 === result2);
      assertFalse(result1 === result3);
    });

    void it('handles various unicode scripts', async () => {
      const chinese = await hashText('你好');
      const arabic = await hashText('مرحبا');
      const cyrillic = await hashText('привет');

      assertFalse(chinese === arabic);
      assertFalse(arabic === cyrillic);
      assertFalse(chinese === cyrillic);
    });
  });

  void describe('case sensitivity', () => {
    void it('returns different hash for different case', async () => {
      const lower = await hashText('hello');
      const upper = await hashText('HELLO');
      const mixed = await hashText('Hello');

      assertFalse(lower === upper);
      assertFalse(lower === mixed);
      assertFalse(upper === mixed);
    });
  });

  void describe('special characters', () => {
    void it('handles newlines and tabs', async () => {
      const withNewline = await hashText('hello\nworld');
      const withTab = await hashText('hello\tworld');
      const withCarriageReturn = await hashText('hello\r\nworld');

      assertFalse(withNewline === withTab);
      assertFalse(withNewline === withCarriageReturn);
    });

    void it('handles special characters', async () => {
      const result1 = await hashText('hello!@#$%^&*()');
      const result2 = await hashText('hello!@#$%^&*()');
      assertTrue(result1 === result2);
    });
  });

  void describe('long strings', () => {
    void it('handles long strings', async () => {
      const longString = 'a'.repeat(10000);
      const result = await hashText(longString);
      assertOk(typeof result === 'bigint');
    });

    void it('returns consistent hash for long strings', async () => {
      const longString = 'a'.repeat(10000);
      const result1 = await hashText(longString);
      const result2 = await hashText(longString);
      assertTrue(result1 === result2);
    });

    void it('returns different hash for slightly different long strings', async () => {
      const longString1 = 'a'.repeat(10000);
      const longString2 = 'a'.repeat(9999) + 'b';
      const result1 = await hashText(longString1);
      const result2 = await hashText(longString2);
      assertFalse(result1 === result2);
    });
  });

  void describe('hash distribution', () => {
    void it('produces varied hashes for sequential strings', async () => {
      const hashes = new Set<bigint>();
      for (let i = 0; i < 100; i++) {
        const hash = await hashText(`test${i}`);
        hashes.add(hash);
      }
      assertTrue(hashes.size === 100);
    });

    void it('produces varied hashes for similar strings', async () => {
      const hashes = new Set<bigint>();
      const strings = ['cat', 'bat', 'hat', 'mat', 'rat', 'sat'];
      for (const s of strings) {
        const hash = await hashText(s);
        hashes.add(hash);
      }
      assertTrue(hashes.size === strings.length);
    });
  });
});
