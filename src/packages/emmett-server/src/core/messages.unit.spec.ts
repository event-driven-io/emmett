import type { StandardSchemaV1 } from '@standard-schema/spec';
import { describe, expect, it } from 'vitest';
import { DefaultEventStoreApiSchemas } from '../contract';
import { parseAppendRequest, toJSONText } from './messages';

void describe('toJSONText', () => {
  void it('encodes bigint values as decimal strings', () => {
    expect(toJSONText({ streamPosition: 42n })).toBe('{"streamPosition":"42"}');
  });
});

void describe('parseAppendRequest', () => {
  void it('passes valid messages through unchanged', async () => {
    const messages = [{ type: 'A', data: { a: 1 }, metadata: { b: 2 } }];

    expect(
      await parseAppendRequest(DefaultEventStoreApiSchemas.AppendRequest, {
        messages,
      }),
    ).toEqual({ ok: true, messages });
  });

  void it('reports issues with their paths', async () => {
    const result = await parseAppendRequest(
      DefaultEventStoreApiSchemas.AppendRequest,
      { messages: [{ type: '', data: [] }] },
    );

    expect(result.ok).toBe(false);
    expect(
      !result.ok &&
        result.issues.map((issue) => (issue.path as string[]).join('/')),
    ).toEqual(expect.arrayContaining(['messages/0/type', 'messages/0/data']));
  });

  void it('uses any Standard Schema implementation', async () => {
    const onlyOrders: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) =>
          (value as { messages: { type: string }[] }).messages.every(
            (message) => message.type === 'OrderPlaced',
          )
            ? { value }
            : { issues: [{ message: 'only orders' }] },
      },
    };

    expect(
      await parseAppendRequest(onlyOrders, {
        messages: [{ type: 'CartOpened', data: {} }],
      }),
    ).toEqual({ ok: false, issues: [{ message: 'only orders' }] });
  });
});
