import { z } from 'zod';
const isoDate = z.codec(z.iso.datetime(), z.date(), {
  decode: (s) => new Date(s),
  encode: (d) => d.toISOString(),
});
const S = z.object({ at: isoDate });
console.log('decode string', S.safeParse({ at: '2026-10-04T10:00:00.000Z' }));
console.log('decode Date', S.safeParse({ at: new Date('2026-10-04T10:00:00.000Z') }).success);
console.log('encode', z.encode(S, { at: new Date('2026-10-04T10:00:00.000Z') }));
console.log('std validate', await S['~standard'].validate({ at: '2026-10-04T10:00:00.000Z' }));
const std = S['~standard'] as unknown as { jsonSchema: { input: (o: object) => unknown; output: (o: object) => unknown } };
console.log('json input', JSON.stringify(std.jsonSchema.input({ target: 'draft-2020-12' })));
try { console.log('json output', JSON.stringify(std.jsonSchema.output({ target: 'draft-2020-12' }))); } catch (e) { console.log('json output throws:', (e as Error).message); }
try { console.log(JSON.stringify(z.toJSONSchema(z.object({ at: z.date() })))); } catch (e) { console.log('z.date toJSONSchema throws:', (e as Error).message); }
console.log('coerce', JSON.stringify(z.toJSONSchema(z.object({ at: z.coerce.date() }), { unrepresentable: 'any' })));
