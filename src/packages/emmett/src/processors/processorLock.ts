import type { DefaultRecord } from '../typing';

/**
 * Exclusive lock guarding a single processor instance.
 *
 * Identity (processor id, instance id, partition, version) is provided at
 * construction time, the same way the store-specific locks already do it.
 * The handler context is passed per call, so locks living in the message store
 * can run inside the processor's transaction, while external locks ignore it.
 */
export type ProcessorLock<
  HandlerContext extends DefaultRecord = DefaultRecord,
> = {
  tryAcquire: (context: HandlerContext) => Promise<boolean>;
  release: (context: HandlerContext) => Promise<void>;
};

export type LockAcquisitionPolicy =
  | { type: 'fail' }
  | { type: 'skip' }
  | {
      type: 'retry';
      retries: number;
      minTimeout?: number;
      maxTimeout?: number;
    };

export type ProcessorLockOptions<
  HandlerContext extends DefaultRecord = DefaultRecord,
> = {
  lock?: ProcessorLock<HandlerContext>;
  acquisitionPolicy?: LockAcquisitionPolicy;
};

export const DefaultProcessorLockPolicy: LockAcquisitionPolicy = {
  type: 'fail',
};
