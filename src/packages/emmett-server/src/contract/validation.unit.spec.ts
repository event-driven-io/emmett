import { describe, expect, it } from 'vitest';
import { schemaRef } from './schemas';
import { validateAgainstSchema } from './validation';

void describe('validateAgainstSchema', () => {
  void it('accepts a valid append request', () => {
    expect(
      validateAgainstSchema(
        { messages: [{ type: 'OrderPlaced', data: { id: 1 }, metadata: {} }] },
        schemaRef('AppendRequest'),
      ),
    ).toEqual([]);
  });

  void it('reports errors with JSON pointer paths', () => {
    expect(
      validateAgainstSchema(
        { messages: [{ kind: 'Query', type: '', data: null }] },
        schemaRef('AppendRequest'),
      ),
    ).toEqual([
      { path: '/messages/0/kind', message: 'must be one of Event, Command' },
      {
        path: '/messages/0/type',
        message: 'must have at least 1 character(s)',
      },
      { path: '/messages/0/data', message: 'must be of type object' },
    ]);
  });

  void it('reports missing required properties and wrong root type', () => {
    expect(validateAgainstSchema({}, schemaRef('AppendRequest'))).toEqual([
      { path: '/messages', message: 'is required' },
    ]);
    expect(validateAgainstSchema([], schemaRef('AppendRequest'))).toEqual([
      { path: '/', message: 'must be of type object' },
    ]);
  });
});
