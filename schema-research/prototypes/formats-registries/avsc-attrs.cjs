// Checks whether avsc preserves custom (non-Avro) attributes such as doc/units on re-export
const avro = require('../../packages/avsc-5.7.9');
const t = avro.Type.forSchema({
  type: 'record', name: 'R', doc: 'record doc', 'x-emmett-kind': 'Event',
  fields: [{ name: 'weight', doc: 'weight doc', type: { type: 'double', 'x-unit': 'kg' }, 'x-deprecated': true }],
});
console.log(JSON.stringify(t.schema({ exportAttrs: true })));
console.log(JSON.stringify(t.schema()));
