export type SchemaVersionProperty<SchemaVersion extends number> =
  number extends SchemaVersion
    ? { readonly schemaVersion?: SchemaVersion }
    : SchemaVersion extends 1
      ? { readonly schemaVersion?: SchemaVersion }
      : { readonly schemaVersion: SchemaVersion };
