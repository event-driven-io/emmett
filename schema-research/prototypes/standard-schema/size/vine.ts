import vine from '@vinejs/vine';
const s = vine.create({ a: vine.string(), b: vine.number().withoutDecimals(), c: vine.enum(['x','y']), d: vine.string().nullable(), e: vine.array(vine.object({ f: vine.string() })) });
console.log(s['~standard'].validate({}), s['~standard'].jsonSchema.input({ target: 'draft-2020-12' } as any));
