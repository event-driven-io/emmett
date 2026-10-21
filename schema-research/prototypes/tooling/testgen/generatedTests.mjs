// Experiment: can message schemas drive generated tests for an Emmett decider?
// 1. Property test: fuzz commands from their schema, check that every event the
//    decider returns validates against that event's own schema.
// 2. Example generation: derive deterministic example payloads from exported
//    JSON Schema (library-agnostic) and use them in a Given/When/Then spec.
import fc from 'fast-check';
import { generateSync } from 'json-schema-faker';
import { z } from 'zod';
import { DeciderSpecification } from '../../../../src/packages/emmett/src/testing/deciderSpecification.ts';

// Message definitions as a schema-backed Emmett API might hold them.
const messages = {
  ShoppingCartOpened: z.object({ shoppingCartId: z.string().min(1) }),
  ProductItemAdded: z.object({
    shoppingCartId: z.string().min(1),
    productId: z.string().min(1),
    quantity: z.int().positive(),
  }),
  AddProductItem: z.object({
    shoppingCartId: z.string().min(1),
    productId: z.string().min(1),
    quantity: z.int().positive(),
  }),
};

const decide = (command, state) => {
  if (state.status !== 'Opened') throw new Error('Cart not opened');
  return {
    type: 'ProductItemAdded',
    data: {
      shoppingCartId: command.data.shoppingCartId,
      productId: command.data.productId,
      quantity: command.data.quantity,
    },
  };
};
const evolve = (state, event) =>
  event.type === 'ShoppingCartOpened' ? { status: 'Opened' } : state;
const initialState = () => ({ status: 'Empty' });

const jsonSchemaOf = (schema) =>
  schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' });

// 1. Property test from schemas. A seeded JSON Schema generator wrapped as a
// fast-check arbitrary works for any library implementing Standard JSON Schema.
// (zxTest.fuzz from @traversable/zod-test produced invalid data with zod 4.6.5,
// see fuzzValidity-output.txt.)
const fromJsonSchema = (schema) =>
  fc.integer({ min: 1 }).map((seed) => generateSync(jsonSchemaOf(schema), { seed }));
const commandArb = fromJsonSchema(messages.AddProductItem);
const openedArb = fromJsonSchema(messages.ShoppingCartOpened);

fc.assert(
  fc.property(openedArb, commandArb, (opened, command) => {
    const state = evolve(initialState(), { type: 'ShoppingCartOpened', data: opened });
    const result = [decide({ type: 'AddProductItem', data: command }, state)].flat();
    for (const event of result) {
      const check = messages[event.type]['~standard'].validate(event.data);
      if (check.issues) throw new Error(JSON.stringify(check.issues));
    }
  }),
  { numRuns: 200 },
);
console.log('property: 200 fuzzed commands produced schema-valid events');

// 2. Examples from exported JSON Schema (works for any Standard JSON Schema lib).

const example = (name, seed) => generateSync(jsonSchemaOf(messages[name]), { seed });

const opened = example('ShoppingCartOpened', 1);
const addCommand = { ...example('AddProductItem', 2), shoppingCartId: opened.shoppingCartId };
console.log('examples:', JSON.stringify({ opened, addCommand }));
console.log(
  'same seed, same example:',
  JSON.stringify(example('AddProductItem', 2)) === JSON.stringify(example('AddProductItem', 2)),
);

const given = DeciderSpecification.for({ decide, evolve, initialState });

given([{ type: 'ShoppingCartOpened', data: opened }])
  .when({ type: 'AddProductItem', data: addCommand })
  .then([{ type: 'ProductItemAdded', data: addCommand }]);
console.log('Given/When/Then with generated examples: passed');

given([])
  .when({ type: 'AddProductItem', data: addCommand })
  .thenThrows((error) => error.message === 'Cart not opened');
console.log('Given(no events)/When/ThenThrows with generated examples: passed');
