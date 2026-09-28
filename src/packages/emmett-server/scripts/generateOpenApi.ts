import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventStoreOpenApiDocument } from '../src/contract';

/**
 * Writes the canonical OpenAPI 3.1 document packaged with the server build.
 * The `openApi.contract.unit.spec.ts` test fails when it is out of date,
 * so contract changes are always reviewed explicitly.
 */
const target = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../openapi/v1.json',
);

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(
  target,
  `${JSON.stringify(eventStoreOpenApiDocument(), null, 2)}\n`,
);

console.log(`OpenAPI document written to ${target}`);
