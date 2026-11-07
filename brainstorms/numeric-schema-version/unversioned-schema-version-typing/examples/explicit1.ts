import type { Event } from './typing';
import { event } from './typing';
type V1Explicit = Event<'ProductItemAdded', { productId: string }, undefined, 1>;
// REPORT x1: helper without version for explicit 1
export const noArg: V1Explicit = event<V1Explicit>('ProductItemAdded', { productId: 'p' });
// REPORT x2: helper with version for explicit 1
export const withArg: V1Explicit = event<V1Explicit>('ProductItemAdded', { productId: 'p' }, 1);
