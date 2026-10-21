import { type } from 'arktype';
import * as v from 'valibot';
import { Schema } from 'effect';
import Type from 'typebox';
import Value from 'typebox/value';

const at = type({ at: 'string.date.iso.parse' });
console.log('arktype', at({ at: '2026-10-04T10:00:00.000Z' }), JSON.stringify(at.in.toJsonSchema()));
console.log('arktype std jsonSchema?', typeof (at['~standard'] as unknown as { jsonSchema?: unknown }).jsonSchema);
const vs = v.object({ at: v.pipe(v.string(), v.isoTimestamp(), v.transform((s) => new Date(s))) });
console.log('valibot', await vs['~standard'].validate({ at: '2026-10-04T10:00:00.000Z' }));
const es = Schema.Struct({ at: Schema.DateFromString });
console.log('effect has ~standard?', '~standard' in es);
const est = Schema.toStandardSchemaV1(es);
console.log('effect', await est['~standard'].validate({ at: '2026-10-04T10:00:00.000Z' }));
const ejs = Schema.toStandardJSONSchemaV1(es);
console.log('effect json', JSON.stringify(ejs['~standard'].jsonSchema.input({ target: 'draft-2020-12' })));
console.log('typebox Codec?', typeof (Type as unknown as Record<string, unknown>).Codec);
