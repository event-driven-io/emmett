import * as z from 'zod/mini';
const s = z.object({ a: z.string(), b: z.int(), c: z.enum(['x','y']), d: z.nullable(z.string()), e: z.array(z.object({ f: z.string() })) });
console.log(s['~standard'].validate({}));
