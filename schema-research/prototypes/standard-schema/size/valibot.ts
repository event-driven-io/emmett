import * as v from 'valibot';
import { toStandardJsonSchema } from '@valibot/to-json-schema';
const s = toStandardJsonSchema(v.object({ a: v.string(), b: v.pipe(v.number(), v.integer()), c: v.picklist(['x','y']), d: v.nullable(v.string()), e: v.array(v.object({ f: v.string() })) }));
console.log(s['~standard'].validate({}), s['~standard'].jsonSchema.input({ target: 'draft-2020-12' }));
