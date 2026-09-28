import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { eventStoreOpenApiDocument } from '../src/contract';

/**
 * Writes the canonical OpenAPI 3.1 document packaged with the server build.
 * The `openApi.unit.spec.ts` test fails when it is out of date,
 * so contract changes are always reviewed explicitly.
 */
const target = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../openapi/v1.json',
);

const prettierConfig = await prettier.resolveConfig(target);

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(
  target,
  await prettier.format(JSON.stringify(eventStoreOpenApiDocument()), {
    ...prettierConfig,
    parser: 'json',
  }),
);

console.log(`OpenAPI document written to ${target}`);
