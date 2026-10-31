import avro from 'avsc';
import { ObjectId } from 'mongodb';

const schema: avro.Schema = {
  type: 'record',
  name: 'Cart',
  fields: [{ name: 'ownerId', type: { type: 'string', logicalType: 'object-id' } }],
};

const plain = avro.Type.forSchema(schema);
const decodedPlain = plain.fromBuffer(plain.toBuffer({ ownerId: '64f000000000000000000001' }));
console.log('unknown logicalType, no implementation: value type =', typeof decodedPlain.ownerId);

class ObjectIdType extends avro.types.LogicalType {
  override _fromValue(value: string) {
    return new ObjectId(value);
  }
  override _toValue(value: unknown) {
    return value instanceof ObjectId ? value.toHexString() : undefined;
  }
  override _resolve(type: avro.Type) {
    return avro.Type.isType(type, 'string', 'logical:object-id') ? this._fromValue : undefined;
  }
}

const withLogical = avro.Type.forSchema(schema, { logicalTypes: { 'object-id': ObjectIdType } });
const decoded = withLogical.fromBuffer(withLogical.toBuffer({ ownerId: new ObjectId('64f000000000000000000001') }));
console.log('registered logicalType at forSchema: value is ObjectId =', decoded.ownerId instanceof ObjectId);
