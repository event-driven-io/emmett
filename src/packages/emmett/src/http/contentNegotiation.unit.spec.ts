import { describe, expect, it } from 'vitest';
import { isJSONContentType, negotiateMediaType } from './contentNegotiation';

const supported = [
  'application/json',
  'application/hal+json',
  'application/json-seq',
] as const;

void describe('negotiateMediaType', () => {
  void it('returns the default type when Accept is missing or */*', () => {
    expect(negotiateMediaType(undefined, supported)).toBe('application/json');
    expect(negotiateMediaType('*/*', supported)).toBe('application/json');
  });

  void it('returns the explicitly requested type', () => {
    expect(negotiateMediaType('application/hal+json', supported)).toBe(
      'application/hal+json',
    );
  });

  void it('prefers the type with the higher quality', () => {
    expect(
      negotiateMediaType(
        'application/json;q=0.5, application/json-seq',
        supported,
      ),
    ).toBe('application/json-seq');
  });

  void it('prefers a specific range over a wildcard', () => {
    expect(
      negotiateMediaType('*/*;q=0.9, application/hal+json;q=0.9', supported),
    ).toBe('application/hal+json');
  });

  void it('returns undefined when nothing is acceptable', () => {
    expect(negotiateMediaType('text/html', supported)).toBeUndefined();
    expect(
      negotiateMediaType('application/json;q=0', ['application/json']),
    ).toBeUndefined();
  });
});

void describe('isJSONContentType', () => {
  void it('accepts JSON and +json media types with parameters', () => {
    expect(isJSONContentType('application/json; charset=utf-8')).toBe(true);
    expect(isJSONContentType('application/merge-patch+json')).toBe(true);
  });

  void it('rejects other media types', () => {
    expect(isJSONContentType('text/plain')).toBe(false);
    expect(isJSONContentType(undefined)).toBe(false);
  });
});
