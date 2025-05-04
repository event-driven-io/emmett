import { EmmettError } from '../errors';
import {
  type AnyCommand,
  type AnyEvent,
  type AnyMessage,
  type Command,
  type CommandTypeOf,
  type Event,
  type EventTypeOf,
  type SingleMessageHandler,
  type SingleRawMessageHandlerWithoutContext,
} from '../typing';

export interface CommandSender {
  send<CommandType extends AnyCommand = AnyCommand>(
    command: CommandType,
  ): Promise<void>;
}

export interface EventsPublisher {
  publish<EventType extends AnyEvent = AnyEvent>(
    event: EventType,
  ): Promise<void>;
}

export type ScheduleOptions = { afterInMs: number } | { at: Date };

export interface MessageScheduler<CommandOrEvent extends AnyCommand | Event> {
  schedule<MessageType extends CommandOrEvent>(
    message: MessageType,
    when?: ScheduleOptions,
  ): void;
}

export interface CommandBus extends CommandSender, MessageScheduler<Command> {}

export interface EventBus extends EventsPublisher, MessageScheduler<Event> {}

export interface MessageBus extends CommandBus, EventBus {
  schedule<MessageType extends AnyCommand | Event>(
    message: MessageType,
    when?: ScheduleOptions,
  ): void;
}

export interface CommandProcessor {
  handle<CommandType extends AnyCommand>(
    commandHandler: SingleMessageHandler<CommandType>,
    ...commandTypes: CommandTypeOf<CommandType>[]
  ): void;
}
export interface EventSubscription {
  subscribe<EventType extends AnyEvent>(
    eventHandler: SingleMessageHandler<EventType>,
    ...eventTypes: EventTypeOf<EventType>[]
  ): void;
}

export type ScheduledMessage = {
  message: AnyMessage;
  options?: ScheduleOptions;
};

export interface ScheduledMessageProcessor {
  dequeue(): ScheduledMessage[];
}

export type MessageSubscription = EventSubscription | CommandProcessor;

export const getInMemoryMessageBus = (): MessageBus &
  EventSubscription &
  CommandProcessor &
  ScheduledMessageProcessor => {
  const allHandlers = new Map<
    string,
    SingleRawMessageHandlerWithoutContext<AnyMessage>[]
  >();
  let pendingMessages: ScheduledMessage[] = [];

  return {
    send: async <CommandType extends AnyCommand = AnyCommand>(
      command: CommandType,
    ): Promise<void> => {
      const handlers = allHandlers.get(command.type as string);

      if (handlers === undefined || handlers.length === 0)
        throw new EmmettError(
          `No handler registered for command ${command.type}!`,
        );

      const commandHandler = handlers[0]!;

      await commandHandler(command);
    },

    publish: async <EventType extends AnyEvent = AnyEvent>(
      event: EventType,
    ): Promise<void> => {
      const handlers = allHandlers.get(event.type as string) ?? [];

      for (const handler of handlers) {
        const eventHandler = handler;

        await eventHandler(event);
      }
    },

    schedule: <MessageType extends AnyMessage>(
      message: MessageType,
      when?: ScheduleOptions,
    ): void => {
      pendingMessages = [...pendingMessages, { message, options: when }];
    },

    handle: <CommandType extends AnyCommand>(
      commandHandler: SingleMessageHandler<CommandType>,
      ...commandTypes: CommandTypeOf<CommandType>[]
    ): void => {
      const alreadyRegistered = [...allHandlers.keys()].filter((registered) =>
        commandTypes.includes(registered),
      );

      if (alreadyRegistered.length > 0)
        throw new EmmettError(
          `Cannot register handler for commands ${alreadyRegistered.join(', ')} as they're already registered!`,
        );
      for (const commandType of commandTypes) {
        allHandlers.set(commandType, [
          commandHandler as SingleRawMessageHandlerWithoutContext<AnyMessage>,
        ]);
      }
    },

    subscribe<EventType extends AnyEvent>(
      eventHandler: SingleMessageHandler<EventType>,
      ...eventTypes: EventTypeOf<EventType>[]
    ): void {
      for (const eventType of eventTypes) {
        if (!allHandlers.has(eventType)) allHandlers.set(eventType, []);

        allHandlers.set(eventType, [
          ...(allHandlers.get(eventType) ?? []),
          eventHandler as SingleRawMessageHandlerWithoutContext<AnyMessage>,
        ]);
      }
    },

    dequeue: (): ScheduledMessage[] => {
      const pending = pendingMessages;
      pendingMessages = [];
      return pending;
    },
  };
};
