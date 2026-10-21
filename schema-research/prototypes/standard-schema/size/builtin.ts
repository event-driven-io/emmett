import { object, string, integer, literal, nullable, array } from '../builtin-lib.ts';
const s = object({ a: string(), b: integer(), c: literal('x','y'), d: nullable(string()), e: array(object({ f: string() })) });
console.log(s['~standard'].validate({}), s['~standard'].jsonSchema.input({ target: 'draft-2020-12' }));
