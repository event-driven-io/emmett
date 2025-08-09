export type MongoDBResumeToken = Readonly<{ _data: string }>;
export const isMongoDBResumeToken = (
  value: unknown,
): value is MongoDBResumeToken => {
  return !!(
    typeof value === 'object' &&
    value &&
    '_data' in value &&
    typeof value._data === 'string'
  );
};
