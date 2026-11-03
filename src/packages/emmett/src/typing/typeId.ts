export const emmettTypeId = (name: string): symbol =>
  Symbol.for(`@event-driven-io/emmett/${name}`);

export const hasTypeId = (value: unknown, typeId: symbol): boolean =>
  typeof value === 'object' && value !== null && typeId in value;
