import { Transform, type WritableOptions } from 'stream';

export type SequentialTransformHandler<
  IncomingMessageType = unknown,
  OutgoingMessageType = unknown,
> = {
  handler: (
    message: IncomingMessageType,
  ) => Promise<OutgoingMessageType | null>;
};

export type SequentialTransformOptions<
  IncomingMessageType = unknown,
  OutgoingMessageType = unknown,
> = {
  handler: SequentialTransformHandler<IncomingMessageType, OutgoingMessageType>;
} & WritableOptions;

export class SequentialTransform<
  IncomingMessageType = unknown,
  OutgoingMessageType = unknown,
> extends Transform {
  private handler: SequentialTransformHandler<
    IncomingMessageType,
    OutgoingMessageType
  >;
  constructor(
    options: SequentialTransformOptions<
      IncomingMessageType,
      OutgoingMessageType
    >,
  ) {
    super({ objectMode: true, ...options });
    this.handler = options.handler;
  }

  async _transform(
    message: IncomingMessageType,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): Promise<void> {
    try {
      const result = await this.handler.handler(message);

      this.push(result);

      callback();
    } catch (error) {
      callback(error as Error);
    }
  }
}
