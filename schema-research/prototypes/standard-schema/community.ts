import { toJsonSchema as standardJson } from '@standard-community/standard-json';
import { toJsonSchema as xsJson } from 'xsschema';
import * as v from 'valibot';
import * as z from 'zod';
import { Schema } from 'effect';

const attempt = async (label: string, fn: () => unknown) => {
  try {
    console.log(label, JSON.stringify(await fn()));
  } catch (error) {
    console.log(label, 'THROWS:', (error as Error).message.split('\n')[0]);
  }
};

const valibotSchema = v.object({ cartId: v.pipe(v.string(), v.description('Cart id')) });
const effectSchema = Schema.toStandardSchemaV1(Schema.Struct({ cartId: Schema.String }));

await attempt('standard-json zod:', () => standardJson(z.object({ cartId: z.string() })));
await attempt('standard-json valibot (raw schema):', () => standardJson(valibotSchema));
await attempt('standard-json effect 4:', () => standardJson(effectSchema));
await attempt('xsschema zod:', () => xsJson(z.object({ cartId: z.string() })));
await attempt('xsschema valibot (raw schema):', () => xsJson(valibotSchema));
await attempt('xsschema effect 4 (no ~standard.jsonSchema):', () => xsJson(effectSchema));
await attempt('xsschema effect 4 with toStandardJSONSchemaV1:', () => xsJson(Schema.toStandardJSONSchemaV1(effectSchema)));
