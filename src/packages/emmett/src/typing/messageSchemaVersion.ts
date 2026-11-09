import type { Message, MessageSchemaVersionOf } from './message';

export type SchemaVersionProperty<SchemaVersion extends number> =
  number extends SchemaVersion
    ? { readonly schemaVersion?: SchemaVersion }
    : SchemaVersion extends 1
      ? { readonly schemaVersion?: SchemaVersion }
      : { readonly schemaVersion: SchemaVersion };

export type WithSchemaVersionArgument<
  MessageType extends Message,
  Args extends unknown[],
> = undefined extends MessageType['schemaVersion']
  ? Args
  : [...Args, schemaVersion: MessageSchemaVersionOf<MessageType>];

export const splitMetadataAndSchemaVersion = (
  optionalArguments: unknown[],
): { metadata?: unknown; schemaVersion?: number } => {
  const last = optionalArguments[optionalArguments.length - 1];
  const schemaVersion = typeof last === 'number' ? last : undefined;
  const metadata =
    schemaVersion !== undefined && optionalArguments.length === 1
      ? undefined
      : optionalArguments[0];

  return {
    ...(metadata !== undefined ? { metadata } : {}),
    ...(schemaVersion !== undefined ? { schemaVersion } : {}),
  };
};
