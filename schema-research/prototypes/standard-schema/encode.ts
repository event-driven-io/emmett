// Which libraries can go back from the in-code value to the wire form (encode)? Research check for qa.md Q21.
import { z } from 'zod';
import * as v from 'valibot';
import { type } from 'arktype';
import { Schema } from 'effect';
import Type from 'typebox';
import Value from 'typebox/value';

const event = { confirmedAt: new Date('2026-10-23T10:00:00.000Z') };
const run = (label: string, fn: () => unknown) => {
  try {
    console.log(`${label.padEnd(30)} -> ${JSON.stringify(fn())}`);
  } catch (error) {
    console.log(`${label.padEnd(30)} -> throws ${(error as Error).message.split('\n')[0]}`);
  }
};

const zod = z.object({
  confirmedAt: z.codec(z.iso.datetime(), z.date(), {
    decode: (s) => new Date(s),
    encode: (d) => d.toISOString(),
  }),
});
run('zod z.encode', () => z.encode(zod, event));
run('zod encode of invalid', () => z.encode(zod, { confirmedAt: 'nope' } as never));

const effect = Schema.Struct({ confirmedAt: Schema.DateFromString });
run('effect encodeSync', () => Schema.encodeSync(effect)(event));
run('effect fromJsonString encode', () => Schema.encodeSync(Schema.fromJsonString(effect))(event));

const typebox = Type.Object({
  confirmedAt: Type.Codec(Type.String({ format: 'date-time' }))
    .Decode((s) => new Date(s))
    .Encode((d) => d.toISOString()),
});
run('typebox Value.Encode', () => Value.Encode(typebox, event));

const valibot = v.object({
  confirmedAt: v.pipe(v.string(), v.transform((s) => new Date(s))),
});
run('valibot encode exists', () => 'encode' in v);
const ark = type({ confirmedAt: 'string.date.iso.parse' });
run('arktype encode exists', () => 'encode' in ark);
void valibot;
