import { type } from 'arktype';
const s = type({ a: 'string', b: 'number.integer', c: "'x'|'y'", d: 'string | null', e: type({ f: 'string' }).array() });
console.log(s['~standard'].validate({}), s['~standard'].jsonSchema.input({ target: 'draft-2020-12' }));
