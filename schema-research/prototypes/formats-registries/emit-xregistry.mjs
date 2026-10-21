// Emits a minimal xRegistry (CloudEvents Registry) document for two Emmett events
// and validates it against the official document schema from xregistry/spec.
import { readFileSync, writeFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const definitions = [
  {
    kind: 'Event',
    type: 'ShoppingCartConfirmed',
    module: 'shopping-carts',
    description: 'Client confirmed the shopping cart.',
    versions: [
      {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: 'ShoppingCartConfirmed',
        type: 'object',
        properties: {
          shoppingCartId: { type: 'string', format: 'uuid' },
          confirmedAt: { type: 'string', format: 'date-time' },
        },
        required: ['shoppingCartId', 'confirmedAt'],
        additionalProperties: false,
      },
      {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: 'ShoppingCartConfirmed',
        type: 'object',
        properties: {
          shoppingCartId: { type: 'string', format: 'uuid' },
          confirmedAt: { type: 'string', format: 'date-time' },
          channel: { type: 'string', default: 'web', description: 'Where the cart was confirmed.' },
        },
        required: ['shoppingCartId', 'confirmedAt'],
        additionalProperties: false,
      },
    ],
  },
  {
    kind: 'Command',
    type: 'ConfirmShoppingCart',
    module: 'shopping-carts',
    description: 'Confirm the shopping cart.',
    versions: [
      {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: 'ConfirmShoppingCart',
        type: 'object',
        properties: { shoppingCartId: { type: 'string', format: 'uuid' } },
        required: ['shoppingCartId'],
        additionalProperties: false,
      },
    ],
  },
];

const FORMAT = 'JsonSchema/draft/2020-12';

const toRegistry = (defs) => {
  const messagegroups = {};
  const schemagroups = {};

  for (const def of defs) {
    const mg = (messagegroups[def.module] ??= { messagegroupid: def.module, messages: {} });
    const sg = (schemagroups[def.module] ??= { schemagroupid: def.module, format: FORMAT, schemas: {} });

    const versions = Object.fromEntries(
      def.versions.map((schema, i) => [
        String(i + 1),
        { versionid: String(i + 1), ancestorid: String(Math.max(i, 1)), format: FORMAT, schema },
      ]),
    );
    sg.schemas[def.type] = {
      schemaid: def.type,
      description: def.description,
      labels: { 'emmett.kind': def.kind.toLowerCase() },
      meta: { compatibility: 'backward' },
      versions,
    };

    mg.messages[def.type] = {
      messageid: def.type,
      description: def.description,
      labels: { 'emmett.kind': def.kind.toLowerCase() },
      dataschemaformat: FORMAT,
      dataschemauri: `#/schemagroups/${def.module}/schemas/${def.type}`,
      datacontenttype: 'application/json',
    };
  }

  return { specversion: '1.0-rc4', registryid: 'emmett-sample', messagegroups, schemagroups };
};

const doc = toRegistry(definitions);
writeFileSync(new URL('./emmett-sample.xreg.json', import.meta.url), JSON.stringify(doc, null, 2));

const documentSchema = JSON.parse(
  readFileSync(new URL('../../sources/formats-registries/xregistry-cloudevents-document-schema.json', import.meta.url)),
);
const compile = (uriFormat) => {
  const ajv = new Ajv({ strict: false, allErrors: true, logger: false });
  addFormats(ajv, ['date-time', 'uuid']);
  ajv.addFormat('uri', uriFormat);
  ajv.addFormat('xid', true);
  ajv.addFormat('base64', true);
  return ajv.compile(documentSchema);
};
const absoluteUri = (value) => URL.canParse(value);
const uriReference = (value) => URL.canParse(value, 'https://registry.invalid/');

const strictValidate = compile(absoluteUri);
console.log('valid with "uri" as absolute URI:', strictValidate(doc));
// The spec prose allows relative references for dataschemauri, so check again treating "uri" as uri-reference
const validate = compile(uriReference);
console.log('valid with "uri" treated as uri-reference:', validate(doc));
if (!validate.errors) process.exit(0);
for (const e of validate.errors.slice(0, 15)) console.log(e.instancePath, e.message, JSON.stringify(e.params));
