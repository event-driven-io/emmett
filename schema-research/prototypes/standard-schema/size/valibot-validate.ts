import * as v from 'valibot';
const s = v.object({ a: v.string(), b: v.pipe(v.number(), v.integer()), c: v.picklist(['x','y']), d: v.nullable(v.string()), e: v.array(v.object({ f: v.string() })) });
console.log(s['~standard'].validate({}));
