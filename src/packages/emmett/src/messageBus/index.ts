import { EmmettError } from '../errors';
import {
  type Command,
  type CommandTypeOf,
  type Event,
  type EventTypeOf,
} from '../typing';

export interface CommandSender {
  send<CommandType extends Command = Command>(
    command: CommandType,
  ): Promise<void>;
}

export interface EventsPublisher {
  publish<EventType extends Event = Event>(event: EventType): Promise<void>;
}

export type ScheduleOptions = { afterInMs: number } | { at: Date };

export interface MessageScheduler<CommandOrEvent extends Command | Event> {
  schedule<MessageType extends CommandOrEvent>(
    message: MessageType,
    when?: ScheduleOptions,
  ): void;
}

export interface CommandBus extends CommandSender, MessageScheduler<Command> {}

export interface EventBus extends EventsPublisher, MessageScheduler<Event> {}

export interface MessageBus extends CommandBus, EventBus {
  schedule<MessageType extends Command | Event>(
    message: MessageType,
    when?: ScheduleOptions,
  ): void;
}

type CommandHandler<CommandType extends Command = Command> = (
  command: CommandType,
) => Promise<void> | void;

export interface CommandProcessor {
  handle<CommandType extends Command>(
    commandHandler: CommandHandler<CommandType>,
    ...commandTypes: CommandTypeOf<CommandType>[]
  ): void;
}

type EventHandler<EventType extends Event = Event> = (
  event: EventType,
) => Promise<void> | void;

export interface EventProcessor {
  subscribe<EventType extends Event>(
    eventHandler: EventHandler<EventType>,
    ...eventTypes: EventTypeOf<EventType>[]
  ): void;
}

export type ScheduledMessage = {
  message: Event | Command;
  options?: ScheduleOptions;
};

export interface ScheduledMessageProcessor {
  dequeue(): ScheduledMessage[];
}

export type MessageHandler = CommandHandler | EventHandler;

export type MessageProcessor = EventProcessor | CommandProcessor;

export const getInMemoryMessageBus = (): MessageBus &
  MessageProcessor &
  ScheduledMessageProcessor => {
  const allHandlers = new Map<string, MessageHandler[]>();
  let pendingMessages: ScheduledMessage[] = [];

  return {
    send: async <CommandType extends Command = Command>(
      command: CommandType,
    ): Promise<void> => {
      const handlers = allHandlers.get(command.type);

      if (handlers === undefined || handlers.length === 0)
        throw new EmmettError(
          `No handler registered for command ${command.type}!`,
        );

      const commandHandler = handlers[0] as CommandHandler<CommandType>;

      await commandHandler(command);
    },

    publish: async <EventType extends Event = Event>(
      event: EventType,
    ): Promise<void> => {
      const handlers = allHandlers.get(event.type) ?? [];

      for (const handler of handlers) {
        const eventHandler = handler as EventHandler<EventType>;

        await eventHandler(event);
      }
    },

    schedule: <MessageType extends Command | Event>(
      message: MessageType,
      when?: ScheduleOptions,
    ): void => {
      pendingMessages = [...pendingMessages, { message, options: when }];
    },

    handle: <CommandType extends Command>(
      commandHandler: CommandHandler<CommandType>,
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
        allHandlers.set(commandType, [commandHandler as MessageHandler]);
      }
    },

    subscribe<EventType extends Event>(
      eventHandler: EventHandler<EventType>,
      ...eventTypes: EventTypeOf<EventType>[]
    ): void {
      for (const eventType of eventTypes) {
        if (!allHandlers.has(eventType)) allHandlers.set(eventType, []);

        allHandlers.set(eventType, [
          ...(allHandlers.get(eventType) ?? []),
          eventHandler as MessageHandler,
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
