import { Event, s } from '../lib';
export const Opened = Event('Opened', { data: { cartId: s.string() } });
export interface Opened extends typeof Opened.Type {}
