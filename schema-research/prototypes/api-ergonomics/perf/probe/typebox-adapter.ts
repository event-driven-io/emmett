import Type from 'typebox';
import { standard } from '../../lib/typebox';
export const isoDate = Type.Codec(Type.String({ format: 'date-time' })).Decode((iso) => new Date(iso)).Encode((d) => d.toISOString());
export const S = standard(Type.Object({ a: Type.String(), b: Type.Number(), at: isoDate }));
