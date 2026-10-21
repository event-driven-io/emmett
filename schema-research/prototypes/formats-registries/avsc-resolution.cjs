// Verifies Avro schema resolution (writer v1 -> reader v2) with avsc 5.7.9
const avro = require('../../packages/avsc-5.7.9');

const v1 = avro.Type.forSchema({
  type: 'record', name: 'ShoppingCartConfirmed', namespace: 'shop',
  fields: [
    { name: 'shoppingCartId', type: 'string' },
    { name: 'confirmedAt', type: { type: 'long', logicalType: 'timestamp-millis' } },
  ],
});

const v2 = avro.Type.forSchema({
  type: 'record', name: 'CartConfirmed', namespace: 'shop', aliases: ['shop.ShoppingCartConfirmed'],
  fields: [
    { name: 'cartId', type: 'string', aliases: ['shoppingCartId'] },
    { name: 'confirmedAt', type: { type: 'long', logicalType: 'timestamp-millis' } },
    { name: 'channel', type: 'string', default: 'web' },
  ],
});

const buf = v1.toBuffer({ shoppingCartId: 'c-1', confirmedAt: Date.parse('2026-10-04T10:00:00Z') });
const resolver = v2.createResolver(v1);
console.log('v1 bytes read with v2 schema:', v2.fromBuffer(buf, resolver));

const v3NoDefault = avro.Type.forSchema({
  type: 'record', name: 'ShoppingCartConfirmed', namespace: 'shop',
  fields: [
    { name: 'shoppingCartId', type: 'string' },
    { name: 'confirmedAt', type: 'long' },
    { name: 'channel', type: 'string' },
  ],
});
try { v3NoDefault.createResolver(v1); } catch (e) { console.log('adding required field without default:', e.message); }

const opt = avro.Type.forSchema({ type: 'record', name: 'X', fields: [{ name: 'note', type: ['null', 'string'], default: null }] });
console.log('Avro JSON encoding of union value:', JSON.stringify(opt.toJSON ? opt.toJSON({ note: 'hi' }) : null));
console.log('Plain JSON validated by Avro type isValid({note:"hi"}):', opt.isValid({ note: 'hi' }));
console.log('Avro schema keeps custom attrs? ', JSON.stringify(avro.Type.forSchema({ type: 'string', 'x-unit': 'kg' }).schema({ exportAttrs: true })));
