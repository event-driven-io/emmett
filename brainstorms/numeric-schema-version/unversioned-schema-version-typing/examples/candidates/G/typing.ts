export type DefaultRecord = Record<string, unknown>;
export type DefaultCommandMetadata = { now: Date };

type VersionProp<T extends string, V extends number | undefined> =
  V extends number
    ? { readonly schemaVersion?: V }
    : string extends T
      ? { readonly schemaVersion?: number }
      // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      : {};
export type SchemaVersionOf<T> = NonNullable<
  T extends { readonly schemaVersion?: infer V } ? V : never
>;
export type IsVersioned<T> = number extends SchemaVersionOf<T> ? false : true;

export type Event<
  EventType extends string = string,
  EventData extends DefaultRecord = DefaultRecord,
  EventMetaData extends DefaultRecord | undefined = undefined,
  SchemaVersion extends number | undefined = undefined,
> = Readonly<
  EventMetaData extends undefined
    ? { type: EventType; data: EventData }
    : { type: EventType; data: EventData; metadata: EventMetaData }
> & { readonly kind?: 'Event' } & VersionProp<EventType, SchemaVersion>;

export type Command<
  CommandType extends string = string,
  CommandData extends DefaultRecord = DefaultRecord,
  CommandMetaData extends DefaultRecord | undefined = undefined,
  SchemaVersion extends number | undefined = undefined,
> = Readonly<
  CommandMetaData extends undefined
    ? {
        type: CommandType;
        data: Readonly<CommandData>;
        metadata?: DefaultCommandMetadata | undefined;
      }
    : { type: CommandType; data: CommandData; metadata: CommandMetaData }
> & { readonly kind?: 'Command' } & VersionProp<CommandType, SchemaVersion>;

export type Message<
  Type extends string = string,
  Data extends DefaultRecord = DefaultRecord,
  MetaData extends DefaultRecord | undefined = undefined,
  SchemaVersion extends number | undefined = undefined,
> =
  | Command<Type, Data, MetaData, SchemaVersion>
  | Event<Type, Data, MetaData, SchemaVersion>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyEvent = Event<any, any, any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCommand = Command<any, any, any, any>;
export type AnyMessage = AnyEvent | AnyCommand;

export type EventTypeOf<T extends Event> = T['type'];
export type EventDataOf<T extends Event> = T['data'];
export type EventMetaDataOf<T extends Event> = T extends { metadata: infer M }
  ? M
  : undefined;

export type RecordedMessage<MessageType extends Message = Message> =
  MessageType & {
    readonly schemaVersion: number;
    readonly metadata: { streamName: string; messageId: string };
    kind: 'Event' | 'Command';
  };

export type MessageUpcast<
  MessageType extends AnyMessage,
  MessagePayloadType extends AnyMessage = MessageType,
> =
  | ((message: MessagePayloadType) => MessageType)
  | ((message: RecordedMessage<MessagePayloadType>) => RecordedMessage<MessageType>);

export const upcastRecordedMessage = <
  MessageType extends AnyMessage,
  MessagePayloadType extends AnyMessage = MessageType,
>(
  recordedMessage: RecordedMessage<MessagePayloadType>,
  options?: { upcast?: MessageUpcast<MessageType, MessagePayloadType> },
): RecordedMessage<MessageType> => {
  if (!options?.upcast)
    return recordedMessage as unknown as RecordedMessage<MessageType>;
  const upcasted = options.upcast(
    recordedMessage as RecordedMessage<MessagePayloadType>,
  );
  return {
    ...recordedMessage,
    type: upcasted.type,
    data: upcasted.data as unknown,
    schemaVersion: upcasted.schemaVersion ?? recordedMessage.schemaVersion,
  } as unknown as RecordedMessage<MessageType>;
};

export const event = <
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  EventType extends Event<string, any, any, any>,
>(
  ...args: EventMetaDataOf<EventType> extends undefined
    ? IsVersioned<EventType> extends true
      ? [type: EventTypeOf<EventType>, data: EventDataOf<EventType>, schemaVersion: SchemaVersionOf<EventType>]
      : [type: EventTypeOf<EventType>, data: EventDataOf<EventType>]
    : IsVersioned<EventType> extends true
      ? [type: EventTypeOf<EventType>, data: EventDataOf<EventType>, metadata: EventMetaDataOf<EventType>, schemaVersion: SchemaVersionOf<EventType>]
      : [type: EventTypeOf<EventType>, data: EventDataOf<EventType>, metadata: EventMetaDataOf<EventType>]
): EventType => {
  const [type, data, third, fourth] = args as unknown[];
  const schemaVersion = typeof third === 'number' ? third : fourth;
  const metadata = typeof third === 'number' ? undefined : third;
  return {
    type,
    data,
    ...(metadata !== undefined ? { metadata } : {}),
    ...(schemaVersion !== undefined ? { schemaVersion } : {}),
    kind: 'Event',
  } as unknown as EventType;
};
