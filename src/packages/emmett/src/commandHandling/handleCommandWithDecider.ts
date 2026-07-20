import type { EventStore } from '../eventStore';
import type { Command, Event } from '../typing';
import type { Decider } from '../typing/decider';
import {
  CommandHandler,
  type BeforeAllContext,
  type CommandHandlerOptions,
  type CommandHandlerResult,
  type HandleOptions,
} from './handleCommand';
import {
  append,
  composeMiddleware,
  resolveMiddleware,
  type MiddlewareOptions,
} from './middleware';

const commandTypesOf = (commands: Command | Command[]): string | string[] =>
  Array.isArray(commands) ? commands.map((c) => c.type) : commands.type;

// #region command-handler

export type DeciderCommandHandlerOptions<
  State,
  CommandType extends Command,
  StreamEvent extends Event,
  StoredEvent extends Event = StreamEvent,
> = Omit<CommandHandlerOptions<State, StreamEvent, StoredEvent>, 'middleware'> &
  Decider<State, CommandType, StreamEvent> & {
    middleware?: MiddlewareOptions<
      CommandType,
      State,
      StreamEvent,
      (
        commands: CommandType | CommandType[],
        context: BeforeAllContext,
      ) => void | Promise<void>,
      <Store extends EventStore>(
        result: CommandHandlerResult<State, StreamEvent, Store>,
        context: BeforeAllContext<Store>,
      ) => void | Promise<void>
    >;
  };

export const DeciderCommandHandler =
  <
    State,
    CommandType extends Command,
    StreamEvent extends Event,
    StoredEvent extends Event = StreamEvent,
  >(
    options: DeciderCommandHandlerOptions<
      State,
      CommandType,
      StreamEvent,
      StoredEvent
    >,
  ) =>
  async <Store extends EventStore>(
    eventStore: Store,
    id: string,
    commands: CommandType | CommandType[],
    handleOptions?: HandleOptions<Store>,
  ) => {
    const { decide, middleware, ...rest } = options;
    const {
      decision: decisionMiddleware,
      beforeAll,
      afterAll,
    } = resolveMiddleware(middleware);

    const deciders = (Array.isArray(commands) ? commands : [commands]).map(
      (command) => async (state: State) => {
        const handler = composeMiddleware<CommandType, State, StreamEvent>(
          (input, decisionState) => {
            const result = decide(input, decisionState);
            return Promise.resolve(
              append(Array.isArray(result) ? result : [result]),
            );
          },
          decisionMiddleware,
        );
        return (await handler(command, state)) as unknown as StreamEvent[];
      },
    );

    // TODO: forwarding an array of command types to a single span attribute
    // mirrors the array-of-handlers case in CommandHandler: revisit once we
    // decide on per-command child scopes vs. a single parent with an array
    // attribute.
    const result = await CommandHandler<State, StreamEvent, StoredEvent>({
      ...rest,
      middleware: beforeAll
        ? {
            beforeAll: (_handlers, context) =>
              beforeAll(commands, { ...context, handleOptions }),
          }
        : undefined,
    })(eventStore, id, deciders, {
      commandType: commandTypesOf(commands),
      ...handleOptions,
    });

    await afterAll?.(result, {
      streamName: (rest.mapToStreamId ?? ((streamId: string) => streamId))(id),
      handleOptions,
    });
    return result;
  };
// #endregion command-handler
