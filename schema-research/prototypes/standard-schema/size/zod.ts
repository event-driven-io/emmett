import * as z from 'zod';
const s = z.object({ a: z.string(), b: z.number().int(), c: z.enum(['x','y']), d: z.string().nullable(), e: z.array(z.object({ f: z.string() })) });
console.log(s['~standard'].validate({}), s['~standard'].jsonSchema.input({ target: 'draft-2020-12' }));
