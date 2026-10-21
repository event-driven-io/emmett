// Validates official xRegistry sample documents against the official CloudEvents Registry document schema,
// once with "uri" as absolute URI (ajv-formats default) and once as uri-reference (what the spec prose allows)
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
const dir = new URL('../../sources/formats-registries/', import.meta.url);
const schema = JSON.parse(readFileSync(new URL('xregistry-cloudevents-document-schema.json', dir)));
const compile = (uriFormat) => {
  const ajv = new Ajv({ strict: false, allErrors: true, logger: false });
  addFormats(ajv, ['date-time', 'uuid']);
  ajv.addFormat('uri', uriFormat);
  ajv.addFormat('xid', true);
  ajv.addFormat('base64', true);
  return ajv.compile(schema);
};
const absolute = compile((v) => URL.canParse(v));
const reference = compile((v) => URL.canParse(v, 'https://registry.invalid/'));
for (const f of process.argv.slice(2)) {
  const doc = JSON.parse(readFileSync(new URL(f, dir)));
  const a = absolute(doc);
  const r = reference(doc);
  console.log(f, '| absolute uri:', a, '| uri-reference:', r, r ? '' : [...new Set(reference.errors.map((e) => `${e.instancePath} ${e.message}`))].slice(0, 3).join('; '));
}
