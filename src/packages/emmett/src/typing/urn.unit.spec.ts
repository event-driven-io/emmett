import assert from 'node:assert';
import { describe, it } from 'node:test';
import { segment, segments, literal, urnSchema, defineURN } from './urn.js';

void describe('URN Builder Functions', () => {
  void describe('segment()', () => {
    void it('returns SegmentSchema with type: segment', () => {
      const result = segment();
      assert.strictEqual(result.type, 'segment');
    });

    void it('returns SegmentSchema without validator when none provided', () => {
      const result = segment();
      assert.strictEqual(result.validator, undefined);
    });

    void it('returns SegmentSchema with validator when provided', () => {
      const validator = (s: string) => s.length > 0;
      const result = segment(validator);
      assert.strictEqual(result.type, 'segment');
      assert.strictEqual(result.validator, validator);
    });
  });

  void describe('segments()', () => {
    void it('returns SegmentsSchema with type: segments', () => {
      const result = segments();
      assert.strictEqual(result.type, 'segments');
    });

    void it('returns SegmentsSchema without validator when none provided', () => {
      const result = segments();
      assert.strictEqual(result.validator, undefined);
    });

    void it('returns SegmentsSchema with validator when provided', () => {
      const validator = (s: string) => s.length > 0;
      const result = segments(validator);
      assert.strictEqual(result.type, 'segments');
      assert.strictEqual(result.validator, validator);
    });
  });

  void describe('literal()', () => {
    void it('returns LiteralSchema with type: literal', () => {
      const result = literal('team');
      assert.strictEqual(result.type, 'literal');
    });

    void it('returns LiteralSchema with provided value', () => {
      const result = literal('team');
      assert.strictEqual(result.value, 'team');
    });

    void it('preserves literal value exactly', () => {
      const result = literal('my-literal-123');
      assert.strictEqual(result.value, 'my-literal-123');
    });
  });

  void describe('urnSchema()', () => {
    void it('returns URNSchema with namespace and pattern', () => {
      const pattern = [segments()];
      const result = urnSchema('org', pattern);
      assert.strictEqual(result.namespace, 'org');
      assert.strictEqual(result.pattern, pattern);
    });

    void it('combines namespace with empty pattern', () => {
      const pattern: [] = [];
      const result = urnSchema('org', pattern);
      assert.strictEqual(result.namespace, 'org');
      assert.deepStrictEqual(result.pattern, []);
    });

    void it('combines namespace with complex pattern', () => {
      const pattern = [segments(), literal('team'), segment()];
      const result = urnSchema('org', pattern);
      assert.strictEqual(result.namespace, 'org');
      assert.strictEqual(result.pattern.length, 3);
      assert.strictEqual(result.pattern[0]?.type, 'segments');
      assert.strictEqual(result.pattern[1]?.type, 'literal');
      assert.strictEqual(result.pattern[2]?.type, 'segment');
    });
  });

  void describe('defineURN()', () => {
    void describe('validate()', () => {
      void it('validates correct namespace prefix', () => {
        const orgURN = defineURN(urnSchema('org', [segments()]));
        assert.strictEqual(orgURN.validate('urn:org:acme'), true);
      });

      void it('rejects wrong namespace', () => {
        const orgURN = defineURN(urnSchema('org', [segments()]));
        assert.strictEqual(orgURN.validate('urn:user:acme'), false);
      });

      void it('rejects string not starting with urn:', () => {
        const orgURN = defineURN(urnSchema('org', [segments()]));
        assert.strictEqual(orgURN.validate('org:acme'), false);
      });

      void it('rejects empty pattern (just namespace)', () => {
        const orgURN = defineURN(urnSchema('org', [segments()]));
        assert.strictEqual(orgURN.validate('urn:org:'), false);
      });

      void it('validates single segment', () => {
        const userURN = defineURN(urnSchema('user', [segment()]));
        assert.strictEqual(userURN.validate('urn:user:123'), true);
      });

      void it('rejects segment with colon (should be single segment)', () => {
        const userURN = defineURN(urnSchema('user', [segment()]));
        assert.strictEqual(userURN.validate('urn:user:123:456'), false);
      });

      void it('validates literal value matching', () => {
        const teamURN = defineURN(
          urnSchema('org', [segments(), literal('team'), segments()]),
        );
        assert.strictEqual(teamURN.validate('urn:org:acme:team:eng'), true);
      });

      void it('rejects literal value mismatch', () => {
        const teamURN = defineURN(
          urnSchema('org', [segments(), literal('team'), segments()]),
        );
        assert.strictEqual(teamURN.validate('urn:org:acme:user:eng'), false);
      });

      void it('validates segments consuming rest of string', () => {
        const orgURN = defineURN(urnSchema('org', [segments()]));
        assert.strictEqual(orgURN.validate('urn:org:acme:emea:sales'), true);
      });

      void it('validates complex pattern with multiple elements', () => {
        const taskURN = defineURN(
          urnSchema('project', [segment(), literal('task'), segment()]),
        );
        assert.strictEqual(taskURN.validate('urn:project:web:task:123'), true);
      });

      void it('rejects pattern mismatch in complex URN', () => {
        const taskURN = defineURN(
          urnSchema('project', [segment(), literal('task'), segment()]),
        );
        assert.strictEqual(taskURN.validate('urn:project:web:bug:123'), false);
      });
    });

    void describe('create()', () => {
      void it('creates URN with empty pattern (no arguments)', () => {
        const emptyURN = defineURN(urnSchema('test', []));
        const result = emptyURN.create();
        assert.strictEqual(result, 'urn:test:');
      });

      void it('creates URN with single segment (one argument)', () => {
        const singleURN = defineURN(urnSchema('user', [segment()]));
        const result = singleURN.create('john');
        assert.strictEqual(result, 'urn:user:john');
      });

      void it('creates URN with multiple segments (multiple arguments)', () => {
        const multiURN = defineURN(urnSchema('org', [segments()]));
        const result = multiURN.create('acme', 'emea', 'sales');
        assert.strictEqual(result, 'urn:org:acme:emea:sales');
      });

      void it('creates URN with literals auto-inserted (not passed as args)', () => {
        const teamURN = defineURN(
          urnSchema('org', [segment(), literal('team'), segment()]),
        );
        const result = teamURN.create('acme', 'engineering');
        assert.strictEqual(result, 'urn:org:acme:team:engineering');
      });

      void it('creates URN with complex pattern (segments, literal, segments)', () => {
        const complexURN = defineURN(
          urnSchema('org', [segments(), literal('team'), segments()]),
        );
        const result = complexURN.create(['acme', 'emea'], ['eng', 'backend']);
        assert.strictEqual(result, 'urn:org:acme:emea:team:eng:backend');
      });
    });
  });
});
