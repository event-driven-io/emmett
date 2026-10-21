import Type, { type StaticDecode, type StaticEncode } from 'typebox';
export const isoDate = Type.Codec(Type.String({ format: 'date-time' })).Decode((iso) => new Date(iso)).Encode((d) => d.toISOString());
export const S = Type.Object({ a: Type.String(), b: Type.Number(), at: isoDate });
export type D = StaticDecode<typeof S>;
export type E = StaticEncode<typeof S>;
