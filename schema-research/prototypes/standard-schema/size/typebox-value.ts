import Type from 'typebox';
import Value from 'typebox/value';
const s = Type.Object({ a: Type.String(), b: Type.Integer(), c: Type.Union([Type.Literal('x'), Type.Literal('y')]), d: Type.Union([Type.String(), Type.Null()]), e: Type.Array(Type.Object({ f: Type.String() })) });
console.log(Value.Check(s, {}), JSON.stringify(s));
