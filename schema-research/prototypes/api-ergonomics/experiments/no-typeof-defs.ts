import { Event, s } from '../lib';
export const Opened = Event('Opened', { data: { cartId: s.string() } });
export const Closed = Event('Closed', { data: { cartId: s.string() } });
