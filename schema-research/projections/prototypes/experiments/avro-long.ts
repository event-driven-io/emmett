import { avroLong } from '../lib/avroSchema.js';
import avro from 'avsc';
for (const schema of ['long', { type: 'record', name: 'R', fields: [{ name: 'n', type: 'long' }] }, { type: 'long', logicalType: 'timestamp-millis' }] as avro.Schema[]) {
  const type = avro.Type.forSchema(schema, { registry: { long: avroLong } });
  try {
    const value = typeof schema === 'string' || 'logicalType' in schema ? 2n ** 60n : { n: 2n ** 60n };
    console.log('OK  ', JSON.stringify(schema), String(type.fromBuffer(type.toBuffer(value)) === value || JSON.stringify(type.fromBuffer(type.toBuffer(value)), (_k, v) => (typeof v === 'bigint' ? `${v}n` : v))));
  } catch (error) {
    console.log('FAIL', JSON.stringify(schema), (error as Error).message);
  }
}
