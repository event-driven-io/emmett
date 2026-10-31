// What Standard JSON Schema output looks like for non-JSON types (Date, bigint, ObjectId) in Zod 4.
import { ObjectId } from 'mongodb';
import { z } from 'zod';

const show = (label: string, schema: z.ZodType) => {
  for (const io of ['input', 'output'] as const) {
    try {
      console.log(`${label} ${io}:`, JSON.stringify(schema['~standard'].jsonSchema[io]({ target: 'draft-2020-12' })));
    } catch (error) {
      console.log(`${label} ${io}: throws ${(error as Error).message.split('\n')[0]}`);
    }
  }
};

show('z.date()', z.date());
show('z.bigint()', z.bigint());
show('z.instanceof(ObjectId)', z.instanceof(ObjectId));
show('z.iso.datetime()', z.iso.datetime());
show('codec iso string -> Date', z.codec(z.iso.datetime(), z.date(), { decode: (s) => new Date(s), encode: (d) => d.toISOString() }));
