import type { ProcessorCheckpoint } from '../../processors';
import { event, type Event, type Message } from '../../typing';

const MessageSourceCaughtUpType = '__emt:MessageSourceCaughtUp' as const;

/**
 * Sent by a message source once it has nothing left to deliver as of now,
 * reporting the checkpoint it reached. The consumer acts on it and strips it,
 * so no processor ever sees one.
 */
export type MessageSourceCaughtUp = Event<
  typeof MessageSourceCaughtUpType,
  { checkpoint: ProcessorCheckpoint },
  { checkpoint: ProcessorCheckpoint }
>;

export const MessageSourceCaughtUp = Object.assign(
  (checkpoint: ProcessorCheckpoint): MessageSourceCaughtUp =>
    event<MessageSourceCaughtUp>(
      MessageSourceCaughtUpType,
      { checkpoint },
      { checkpoint },
    ),
  {
    type: MessageSourceCaughtUpType,
    is: (message: Message): message is MessageSourceCaughtUp =>
      message.type === MessageSourceCaughtUpType,
  } as const,
);

/**
 * Everything a source sends about itself rather than about the store. Checking
 * against the union keeps a new control message covered without touching every
 * place that filters them out.
 */
export type MessageSourceControlMessage = MessageSourceCaughtUp;

export const MessageSourceControlMessage = {
  is: (message: Message): message is MessageSourceControlMessage =>
    MessageSourceCaughtUp.is(message),
  isNot: (message: Message): boolean =>
    !MessageSourceControlMessage.is(message),
} as const;
