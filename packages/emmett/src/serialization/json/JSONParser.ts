export class ParseError extends Error {
  constructor(text: string) {
    super(`Cannot parse! ${text}`);
  }
}

export type Mapper<From, To = From> =
  | ((value: unknown) => To)
  | ((value: Partial<From>) => To)
  | ((value: From) => To)
  | ((value: Partial<To>) => To)
  | ((value: To) => To)
  | ((value: Partial<To | From>) => To)
  | ((value: To | From) => To);

export type MapperArgs<From, To = From> = Partial<From> &
  From &
  Partial<To> &
  To;

export type ParseOptions<From, To = From> = {
  reviver?: (key: string, value: unknown) => unknown;
  map?: Mapper<From, To>;
  typeCheck?: <To>(value: unknown) => value is To;
};

export type StringifyOptions<From, To = From> = {
  map?: Mapper<From, To>;
};

export const JSONParser = {
  stringify: <From, To = From>(
    value: From,
    options?: StringifyOptions<From, To>,
  ) => {
    return JSON.stringify(
      options?.map ? options.map(value as MapperArgs<From, To>) : value,
    );
  },
  parse: <From, To = From>(
    text: string,
    options?: ParseOptions<From, To>,
  ): To | undefined => {
    const parsed: unknown = JSON.parse(text, options?.reviver);

    if (options?.typeCheck && !options?.typeCheck<To>(parsed))
      throw new ParseError(text);

    return options?.map
      ? options.map(parsed as MapperArgs<From, To>)
      : (parsed as To | undefined);
  },
};
