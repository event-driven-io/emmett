// Check Effect 4 Schema -> Arbitrary, JSON Schema export and Standard Schema on one definition.
import { Effect, Schema, Arbitrary } from 'effect';

const AddProductItem = Schema.Struct({
  shoppingCartId: Schema.String.check(Schema.isMinLength(1)),
  productId: Schema.String.check(Schema.isMinLength(1)),
  quantity: Schema.Int.check(Schema.isGreaterThan(0)),
}).annotate({ title: 'AddProductItem', description: 'Add product to cart', examples: [{ shoppingCartId: 'c1', productId: 'p1', quantity: 1 }] });

const samples = await Effect.runPromise(Arbitrary.sampleEffect(Arbitrary.schema(AddProductItem), { size: 50 }));
const decode = Schema.decodeUnknownSync(AddProductItem);
let invalid = 0;
for (const s of samples) { try { decode(s); } catch { invalid++; } }
console.log(`samples: ${samples.length}, invalid: ${invalid}`, JSON.stringify(samples.slice(0, 2)));
console.log(JSON.stringify(Schema.toJsonSchemaDocument(AddProductItem)));
const std = Schema.toStandardJSONSchemaV1(AddProductItem)['~standard'];
console.log('standard vendor:', std.vendor, 'has jsonSchema.input:', typeof std.jsonSchema?.input);
