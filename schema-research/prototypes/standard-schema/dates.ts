// What each library's `~standard.validate` does with an ISO string and with a Date. Research check for qa.md Q19.
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { z } from 'zod';
import * as v from 'valibot';
import { type } from 'arktype';
import { Schema } from 'effect';
import Type from 'typebox';
import Value from 'typebox/value';

const iso = '2026-10-23T10:00:00.000Z';
const date = new Date(iso);

const show = (result: unknown) => {
  const r = result as StandardSchemaV1.Result<unknown>;
  if (r.issues) return `issues: ${r.issues[0]?.message}`;
  return `value: ${r.value instanceof Date ? 'Date' : typeof r.value} ${String(r.value instanceof Date ? r.value.toISOString() : r.value)}`;
};

const check = (label: string, schema: StandardSchemaV1) => {
  for (const [name, input] of [['ISO string', iso], ['Date', date]] as const) {
    try {
      console.log(`${label.padEnd(48)} ${name.padEnd(10)} -> ${show(schema['~standard'].validate(input))}`);
    } catch (error) {
      console.log(`${label.padEnd(48)} ${name.padEnd(10)} -> throws ${(error as Error).message}`);
    }
  }
};

check('zod z.date()', z.date());
check('zod z.coerce.date()', z.coerce.date());
check(
  'zod codec z.iso.datetime() -> z.date()',
  z.codec(z.iso.datetime(), z.date(), {
    decode: (s) => new Date(s),
    encode: (d) => d.toISOString(),
  }),
);
check('valibot v.date()', v.date());
check(
  'valibot pipe(string, isoTimestamp, transform)',
  v.pipe(v.string(), v.isoTimestamp(), v.transform((s) => new Date(s))),
);
check('arktype Date', type('Date'));
check('arktype string.date.iso.parse', type('string.date.iso.parse'));
check('effect Schema.Date', Schema.toStandardSchemaV1(Schema.Date));
check('effect Schema.DateFromString', Schema.toStandardSchemaV1(Schema.DateFromString));

const typeboxDate = Type.Codec(Type.String({ format: 'date-time' }))
  .Decode((s) => new Date(s))
  .Encode((d) => d.toISOString());
for (const [name, input] of [['ISO string', iso], ['Date', date]] as const) {
  try {
    const out = Value.Decode(typeboxDate, input);
    console.log(`${'typebox Codec(String date-time) Value.Decode'.padEnd(48)} ${name.padEnd(10)} -> value: ${out instanceof Date ? 'Date' : typeof out}`);
  } catch (error) {
    console.log(`${'typebox Codec(String date-time) Value.Decode'.padEnd(48)} ${name.padEnd(10)} -> throws ${(error as Error).message}`);
  }
}
