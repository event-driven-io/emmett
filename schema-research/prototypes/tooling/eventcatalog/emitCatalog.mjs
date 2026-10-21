// Experiment: write Emmett-like message definitions into an EventCatalog folder
// using only the MIT-licensed @eventcatalog/sdk (no license key needed).
import fs from 'node:fs';
import path from 'node:path';
import utils from '@eventcatalog/sdk';
import Type from 'typebox';

const catalogDir = path.resolve('./catalog');
fs.rmSync(catalogDir, { recursive: true, force: true });
fs.mkdirSync(catalogDir, { recursive: true });

const sdk = utils(catalogDir);

// Shape an Emmett `Event(...)` / `Command(...)` definition might expose.
const definitions = [
  {
    kind: 'Command',
    type: 'ConfirmShoppingCart',
    version: '1.0.0',
    summary: 'Client confirms the cart',
    data: Type.Object({ shoppingCartId: Type.String() }),
    example: { shoppingCartId: 'cart-1' },
  },
  {
    kind: 'Event',
    type: 'ShoppingCartConfirmed',
    version: '1.0.0',
    summary: 'Cart was confirmed',
    data: Type.Object({
      shoppingCartId: Type.String(),
      confirmedAt: Type.String({ format: 'date-time' }),
    }),
    example: { shoppingCartId: 'cart-1', confirmedAt: '2026-10-04T10:00:00Z' },
  },
];

for (const def of definitions) {
  const write = def.kind === 'Event' ? sdk.writeEvent : sdk.writeCommand;
  const addSchema =
    def.kind === 'Event' ? sdk.addSchemaToEvent : sdk.addSchemaToCommand;
  const addExample =
    def.kind === 'Event' ? sdk.addExampleToEvent : sdk.addExampleToCommand;

  await write(
    {
      id: def.type,
      name: def.type,
      version: def.version,
      summary: def.summary,
      schemaPath: 'schema.json',
      markdown: '<SchemaViewer file="schema.json" />',
      'x-emmett-kind': def.kind,
    },
    { path: `/${def.type}` },
  );
  await addSchema(def.type, {
    schema: JSON.stringify(
      { $schema: 'https://json-schema.org/draft/2020-12/schema', ...def.data },
      null,
      2,
    ),
    fileName: 'schema.json',
  });
  await addExample(def.type, {
    content: JSON.stringify(def.example, null, 2),
    fileName: 'basic.json',
  });
}

// Command handler metadata: receives command, triggers event.
await sdk.writeService(
  {
    id: 'ShoppingCarts',
    name: 'Shopping Carts',
    version: '1.0.0',
    markdown: '',
    receives: [
      {
        id: 'ConfirmShoppingCart',
        version: '1.0.0',
        triggers: [
          {
            id: 'ShoppingCartConfirmed',
            version: '1.0.0',
            condition: 'When cart is opened and not empty',
          },
        ],
      },
    ],
    sends: [{ id: 'ShoppingCartConfirmed', version: '1.0.0' }],
  },
  { path: '/ShoppingCarts' },
);

// Versioning: bump event to 2.0.0, previous copy moves to versioned/1.0.0.
await sdk.writeEvent(
  {
    id: 'ShoppingCartConfirmed',
    name: 'ShoppingCartConfirmed',
    version: '2.0.0',
    summary: 'Cart was confirmed (v2)',
    markdown: '',
  },
  { path: '/ShoppingCartConfirmed', versionExistingContent: true },
);

const listing = (dir, prefix = '') =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? listing(path.join(dir, e.name), `${prefix}${e.name}/`)
      : [`${prefix}${e.name}`],
  );
console.log(listing(catalogDir).join('\n'));
console.log('---');
console.log(
  fs.readFileSync(
    path.join(catalogDir, 'commands/ConfirmShoppingCart/index.mdx'),
    'utf8',
  ),
);
console.log('---');
console.log(
  fs.readFileSync(path.join(catalogDir, 'services/ShoppingCarts/index.mdx'), 'utf8'),
);
const v = await sdk.getEvent('ShoppingCartConfirmed', '1.0.0', { attachSchema: true });
console.log('--- v1 still readable with schema:', v?.version, Object.keys(v?.schema?.properties ?? {}));
