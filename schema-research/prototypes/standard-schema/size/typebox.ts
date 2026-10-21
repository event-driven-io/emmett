import Type from 'typebox';
import { Compile } from 'typebox/compile';
const s = Type.Object({ a: Type.String(), b: Type.Integer(), c: Type.Union([Type.Literal('x'), Type.Literal('y')]), d: Type.Union([Type.String(), Type.Null()]), e: Type.Array(Type.Object({ f: Type.String() })) });
const c = Compile(s);
console.log(c.Check({}), JSON.stringify(s));
