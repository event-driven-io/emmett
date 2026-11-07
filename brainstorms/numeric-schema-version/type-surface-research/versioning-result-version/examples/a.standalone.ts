import type {
  Event,
  MessageDowncast,
  MessageUpcast,
  RecordedMessage,
} from '@event-driven-io/emmett';
import type { D1, D2, Stored, V1, V2 } from './domain';

// Parameter order in the real types: MessageUpcast<Result, Stored>, MessageDowncast<App, Stored>.
// An arrow assigned directly to the union MessageUpcast/MessageDowncast gets no contextual type
// (see a0 below), so the payload and recorded forms are checked one by one.
type PayloadForm<F, In> = Extract<F, (message: In) => unknown>;
type RecordedForm<F, In> = Exclude<F, PayloadForm<F, In>>;

const d1: D1 = { productId: 'p' };
const d2: D2 = { productItem: { productId: 'p', quantity: 1 } };
type A = Event<'A', { a: string }>;
type B = Event<'B', { b: string }>;

// a0: an inline arrow assigned to the union type, unversioned (fails the same way on work4)
// @ts-expect-error a0: no contextual type from the union, so 'B' widens to string
export const a0: MessageUpcast<B, A> = (e: A) => ({ type: 'B', data: { b: e.data.a } });

// 1. MessageDowncast<V2, V1>
type Dn1 = PayloadForm<MessageDowncast<V2, V1>, V2>;
export const dn1ok: Dn1 = () => ({ type: 'ProductItemAdded', data: d1, schemaVersion: 1 });
// @ts-expect-error dn1: result without a version
export const dn1bad: Dn1 = () => ({ type: 'ProductItemAdded', data: d1 });

// 2. MessageDowncast<V2, V1 | V2>
type Dn2 = PayloadForm<MessageDowncast<V2, Stored>, V2>;
export const dn2a: Dn2 = () => ({ type: 'ProductItemAdded', data: d1, schemaVersion: 1 });
export const dn2b: Dn2 = () => ({ type: 'ProductItemAdded', data: d2, schemaVersion: 2 });
// @ts-expect-error dn2c: V1 data with version 2
export const dn2c: Dn2 = () => ({ type: 'ProductItemAdded', data: d1, schemaVersion: 2 });
// @ts-expect-error dn2d: missing version
export const dn2d: Dn2 = () => ({ type: 'ProductItemAdded', data: d1 });

// 3. Upcast from stored V1 | V2 to V2: MessageUpcast<V2, V1 | V2>
type Up3 = PayloadForm<MessageUpcast<V2, Stored>, Stored>;
export const up3ok: Up3 = () => ({ type: 'ProductItemAdded', data: d2, schemaVersion: 2 });
// @ts-expect-error up3: missing version
export const up3bad: Up3 = () => ({ type: 'ProductItemAdded', data: d2 });
// 3b. the literal order from the request, MessageUpcast<V1 | V2, V2>: result V1 | V2, stored V2
type Up3b = PayloadForm<MessageUpcast<Stored, V2>, V2>;
export const up3b: Up3b = () => ({ type: 'ProductItemAdded', data: d2, schemaVersion: 2 });
// @ts-expect-error up3b: missing version
export const up3bBad: Up3b = () => ({ type: 'ProductItemAdded', data: d2 });

// 4. MessageUpcast<V1 | V2, V1 | V2>
type Up4 = PayloadForm<MessageUpcast<Stored, Stored>, Stored>;
export const up4a: Up4 = () => ({ type: 'ProductItemAdded', data: d1, schemaVersion: 1 });
export const up4b: Up4 = () => ({ type: 'ProductItemAdded', data: d2, schemaVersion: 2 });
// @ts-expect-error up4c: V1 member without a version
export const up4c: Up4 = () => ({ type: 'ProductItemAdded', data: d1 });
// @ts-expect-error up4d: V1 data with version 2
export const up4d: Up4 = () => ({ type: 'ProductItemAdded', data: d1, schemaVersion: 2 });
// @ts-expect-error up4e: identity on the union (a V1 input may lack the version)
export const up4e: Up4 = (e) => e;

// 5. Unversioned: unchanged, version optional
type Up5 = PayloadForm<MessageUpcast<B, A>, A>;
type Dn5 = PayloadForm<MessageDowncast<B, A>, B>;
export const up5: Up5 = (e) => ({ type: 'B', data: { b: e.data.a } });
export const dn5: Dn5 = (e) => ({ type: 'A', data: { a: e.data.b } });
export const up5b: Up5 = (e) => ({ type: 'B', data: { b: e.data.a }, schemaVersion: 1 });
export const up5c: PayloadForm<MessageUpcast<A>, A> = (e) => e;

// 6. Recorded form
type RDn1 = RecordedForm<MessageDowncast<V2, V1>, V2>;
export const rdn1ok: RDn1 = (e) => ({ ...e, data: d1, schemaVersion: 1 });
// @ts-expect-error rdn1: version kept as 2 for V1 data
export const rdn1bad: RDn1 = (e) => ({ ...e, data: d1 });
type RDn2 = RecordedForm<MessageDowncast<V2, Stored>, V2>;
export const rdn2a: RDn2 = (e) => ({ ...e, data: d1, schemaVersion: 1 });
export const rdn2b: RDn2 = (e) => e;
// @ts-expect-error rdn2c: V1 data with version 2
export const rdn2c: RDn2 = (e) => ({ ...e, data: d1 });
type RUp3 = RecordedForm<MessageUpcast<V2, Stored>, Stored>;
export const rup3: RUp3 = (e) => (e.schemaVersion === 2 ? e : { ...e, data: d2, schemaVersion: 2 });
// @ts-expect-error rup3bad: V1 recorded passed through as V2
export const rup3bad: RUp3 = (e) => ({ ...e, data: d2 });
type RUp4 = RecordedForm<MessageUpcast<Stored, Stored>, Stored>;
export const rup4: RUp4 = (e) => e;
type RUp5 = RecordedForm<MessageUpcast<B, A>, A>;
export const rup5: RUp5 = (e) => ({ ...e, type: 'B', data: { b: e.data.a } });
export type RecordedFormIsRecorded = Parameters<RUp5>[0] extends RecordedMessage<A> ? true : false;
