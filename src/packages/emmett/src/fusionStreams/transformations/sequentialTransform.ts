import { Transform, type WritableOptions } from 'stream';
import type { EmmettError } from '../../errors';

export type SequentialTransformHandlerResultType = 'ACK' | 'SKIP' | 'STOP';

export type SequentialTransformHandlerResult<OutgoingMessageType = unknown> =
  | { resultType: 'ACK'; message: OutgoingMessageType }
  | { resultType: 'SKIP'; reason?: string }
  | { resultType: 'STOP'; reason?: string; error?: EmmettError };

export type SequentialTransformHandler<
  IncomingMessageType = unknown,
  OutgoingMessageType = unknown,
> = (
  message: IncomingMessageType,
) => Promise<SequentialTransformHandlerResult<OutgoingMessageType>>;

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
      const result = await this.handler(message);

      switch (result.resultType) {
        case 'ACK':
          this.push(result);
          break;
        case 'SKIP':
          break;
        case 'STOP':
          this.push(null);
          break;
      }

      callback();
    } catch (error) {
      callback(error as Error);
    }
  }
}
