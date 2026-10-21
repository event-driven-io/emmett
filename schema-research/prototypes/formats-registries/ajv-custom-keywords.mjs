// Checks how Ajv (default strict mode) treats custom annotation keywords in JSON Schema
import Ajv2020 from 'ajv/dist/2020.js';
const schema = { type: 'object', properties: { weight: { type: 'number', 'x-unit': 'kg', unit: 'kg' } }, deprecated: false };
for (const strict of [true, false]) {
  try { new Ajv2020({ strict }).compile(schema); console.log(`strict=${strict}: compiled`); }
  catch (e) { console.log(`strict=${strict}: ${e.message}`); }
}
const ajv = new Ajv2020();
ajv.addVocabulary(['x-unit', 'unit']);
ajv.compile(schema);
console.log('strict=true with addVocabulary([...]): compiled');
