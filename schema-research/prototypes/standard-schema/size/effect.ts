import { Schema } from 'effect';
const s = Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(Schema.Struct({ a: Schema.String, b: Schema.Int, c: Schema.Literals(['x','y']), d: Schema.NullOr(Schema.String), e: Schema.Array(Schema.Struct({ f: Schema.String })) })));
console.log(s['~standard'].validate({}), s['~standard'].jsonSchema.input({ target: 'draft-2020-12' }));
