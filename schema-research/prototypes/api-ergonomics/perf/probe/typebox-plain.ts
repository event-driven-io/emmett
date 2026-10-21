import Type, { type Static } from 'typebox';
export const isoDate = Type.Codec(Type.String({ format: 'date-time' })).Decode((iso) => new Date(iso)).Encode((d) => d.toISOString());
export const S = Type.Object({ a: Type.String(), b: Type.Number(), at: isoDate });
export type S = Static<typeof S>;
