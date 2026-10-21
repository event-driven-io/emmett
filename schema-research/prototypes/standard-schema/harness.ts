import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';

export const wirePayload = {
  cartId: '6f1c2a8e-0b7a-4d43-9a57-1d2c7c6c1f10',
  confirmedAt: '2026-10-04T10:00:00.000Z',
  totalAmount: 120.5,
  itemsCount: 2,
  status: 'Confirmed',
  discountCode: null,
  items: [{ productId: 'p-1', quantity: 2 }],
  tags: { channel: 'web' },
};

export const badPayload = {
  ...wirePayload,
  cartId: 123,
  itemsCount: 1.5,
  status: 'Unknown',
};

const targets = ['draft-2020-12', 'draft-07', 'openapi-3.0', 'draft-04'] as const;

const describe = (value: unknown): unknown =>
  value instanceof Date
    ? `Date(${value.toISOString()})`
    : typeof value === 'bigint'
      ? `${value}n`
      : value;

const safe = (fn: () => unknown): unknown => {
  try {
    return fn();
  } catch (error) {
    return `THROWS: ${(error as Error).message.split('\n')[0].slice(0, 160)}`;
  }
};

export const inspect = async (
  name: string,
  schema: unknown,
  input: unknown = wirePayload,
  invalid: unknown = badPayload,
) => {
  console.log(`\n===== ${name} =====`);
  const standard = (schema as StandardSchemaV1)['~standard'] as
    | (StandardSchemaV1.Props & Partial<StandardJSONSchemaV1.Props>)
    | undefined;
  if (!standard) {
    console.log('no ~standard property');
    return;
  }
  console.log('vendor:', standard.vendor, 'version:', standard.version);
  console.log('has validate:', typeof standard.validate === 'function');
  console.log('has jsonSchema:', typeof standard.jsonSchema === 'object');

  if (typeof standard.validate === 'function') {
    const raw = safe(() => standard.validate(input));
    const isPromise = raw instanceof Promise;
    const ok = isPromise ? await raw : raw;
    console.log('validate returns Promise:', isPromise);
    const okResult = ok as StandardSchemaV1.Result<Record<string, unknown>>;
    if (typeof okResult === 'string') console.log('validate(good):', okResult);
    else if (okResult.issues) console.log('validate(good) issues:', JSON.stringify(okResult.issues));
    else
      console.log(
        'validate(good) value:',
        JSON.stringify(
          Object.fromEntries(Object.entries(okResult.value).map(([k, v]) => [k, describe(v)])),
        ),
      );
    const badRaw = safe(() => standard.validate(invalid));
    const bad = (badRaw instanceof Promise ? await badRaw : badRaw) as StandardSchemaV1.Result<unknown>;
    if (typeof bad === 'string') console.log('validate(bad):', bad);
    else
      console.log(
        'validate(bad) issues:',
        JSON.stringify(
          bad.issues?.map((i) => ({ message: i.message, path: i.path })),
        ),
      );
  }

  if (standard.jsonSchema) {
    for (const target of targets) {
      console.log(`jsonSchema.input(${target}):`, JSON.stringify(safe(() => standard.jsonSchema!.input({ target }))));
    }
    console.log('jsonSchema.output(draft-2020-12):', JSON.stringify(safe(() => standard.jsonSchema!.output({ target: 'draft-2020-12' }))));
  }
};

export const jsonSchemaOf = (schema: unknown, io: 'input' | 'output' = 'input', target = 'draft-2020-12') => {
  const standard = (schema as StandardJSONSchemaV1)['~standard'];
  return safe(() => standard.jsonSchema[io]({ target }));
};
