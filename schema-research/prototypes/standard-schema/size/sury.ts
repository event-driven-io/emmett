import * as S from 'sury';
S.enableStandardJSONSchema();
const s = S.schema({ a: S.string, b: S.int32, c: S.union(['x','y']), d: S.nullable(S.string), e: S.array(S.schema({ f: S.string })) });
console.log(s['~standard'].validate({}), (s as any)['~standard'].jsonSchema.input({ target: 'draft-2020-12' }));
