// Validate the same event twice: with an ISO string (raw JSON) and with a Date (already revived).
import { JSONSerializer } from '@event-driven-io/emmett';
import * as A from '../styles/a-builtin/shoppingCart';
import * as B from '../styles/b-zod/shoppingCart';
import * as B2 from '../styles/b2-valibot/shoppingCart';
import * as B3 from '../styles/b3-arktype/shoppingCart';
import * as B4 from '../styles/b4-effect/shoppingCart';
import * as B5 from '../styles/b5-typebox/shoppingCart';

const styles = { A, B, B2, B3, B4, B5 };
const at = new Date('2026-10-04T10:00:00.000Z');
const json = JSONSerializer.serialize({
  type: 'ShoppingCartConfirmed',
  data: { shoppingCartId: 'cart-1', confirmedAt: at },
  metadata: { clientId: 'c1' },
});
const raw: unknown = JSON.parse(json);
const revived: unknown = JSONSerializer.deserialize(json, { parseDates: true });

for (const [name, style] of Object.entries(styles)) {
  const fromString = await style.ShoppingCartConfirmed.validate(raw);
  const fromDate = await style.ShoppingCartConfirmed.validate(revived);
  console.log(
    name.padEnd(3),
    '| ISO string ->',
    fromString.issues ? `issues ${JSON.stringify(fromString.issues)}` : `ok, Date? ${fromString.value.data.confirmedAt instanceof Date}`,
    '| Date ->',
    fromDate.issues ? `issues ${JSON.stringify(fromDate.issues)}` : `ok, Date? ${fromDate.value.data.confirmedAt instanceof Date}`,
  );
}
console.log('JSON Schema (A):', JSON.stringify(A.ShoppingCartConfirmed.toJSONSchema()));
for (const [name, style] of Object.entries(styles)) {
  try {
    const schema = style.ShoppingCartConfirmed.toJSONSchema() as { properties: { data: { properties?: Record<string, unknown> } } };
    console.log(`JSON Schema (${name}) confirmedAt:`, JSON.stringify(schema.properties.data.properties?.['confirmedAt'] ?? schema.properties.data).slice(0, 160));
  } catch (error) {
    console.log(`JSON Schema (${name}) throws:`, (error as Error).message);
  }
}
