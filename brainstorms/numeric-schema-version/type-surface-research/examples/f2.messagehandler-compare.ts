import type { AnyMessage, Event, MessageHandler, RecordedMessage } from '@event-driven-io/emmett';

// Same as f5 in f.any-handlers.ts, with unversioned types only, to run on orig/ and work/.
type A = Event<'A', { a: string }>;
type B = Event<'B', { b: string }>;
const typed: MessageHandler<A | B> = (m: RecordedMessage<A | B>) => {
  void m.type;
};
export const g1: MessageHandler<AnyMessage> = typed;
// contextual typing of an unannotated handler
export const g2: MessageHandler<A | B> = (m) => {
  void m.type;
};
