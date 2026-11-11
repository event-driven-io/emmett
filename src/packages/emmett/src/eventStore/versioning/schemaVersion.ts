import { ValidationError } from '../../errors';
import { DefaultMessageSchemaVersion } from '../../typing';

export const isNumericSchemaVersion = (value: unknown): boolean =>
  (typeof value === 'number' && Number.isInteger(value) && value >= 0) ||
  (typeof value === 'string' && /^[0-9]+$/.test(value));

export const resolveSchemaVersion = (
  stored: unknown,
  metadata?: unknown,
): number => {
  if (isNumericSchemaVersion(stored)) return Number(stored);

  const metadataSchemaVersion =
    typeof metadata === 'object' &&
    metadata !== null &&
    'schemaVersion' in metadata
      ? metadata.schemaVersion
      : undefined;

  return isNumericSchemaVersion(metadataSchemaVersion)
    ? Number(metadataSchemaVersion)
    : DefaultMessageSchemaVersion;
};

export const schemaVersionToAppend = (
  schemaVersion: number | undefined,
  metadata: unknown,
): number => {
  const version = schemaVersion ?? resolveSchemaVersion(undefined, metadata);

  if (!Number.isInteger(version) || version < 1)
    throw new ValidationError(
      `Schema version must be a whole number of 1 or more, got: ${version}`,
    );

  return version;
};

export const withoutSchemaVersion = <Metadata extends object>(
  metadata: Metadata,
): Omit<Metadata, 'schemaVersion'> => {
  const { schemaVersion: _schemaVersion, ...rest } = metadata as Metadata & {
    schemaVersion?: unknown;
  };
  return rest;
};
