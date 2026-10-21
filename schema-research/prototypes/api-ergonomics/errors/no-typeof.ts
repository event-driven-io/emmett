import { Event, s } from '../lib';
// 7. Using the const directly as a type
export const Confirmed7 = Event('Confirmed7', { data: { id: s.string() } });
export const handle7 = (e: Confirmed7) => e;
// 8. Destructuring a value and a type in one export
export const handle8 = (e: ReturnType<Confirmed7>) => e;
