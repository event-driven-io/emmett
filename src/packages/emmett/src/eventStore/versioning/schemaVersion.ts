export const isNumericSchemaVersion = (value: unknown): boolean =>
  (typeof value === 'number' && Number.isInteger(value)) ||
  (typeof value === 'string' && /^[0-9]+$/.test(value));

export const resolveSchemaVersion = (
  stored: unknown,
  metadata: unknown,
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
    : 1;
};

export const withoutSchemaVersion = <Metadata extends object>(
  metadata: Metadata,
): Omit<Metadata, 'schemaVersion'> => {
  const { schemaVersion: _schemaVersion, ...rest } = metadata as Metadata & {
    schemaVersion?: unknown;
  };
  return rest;
};
