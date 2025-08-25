import assert from 'assert';

export class CancellationPromise<T = unknown> extends Promise<T> {
  private _resolve: (value: T | PromiseLike<T>) => void;
  private _reject: (reason?: unknown) => void;
  private _state: 'resolved' | 'rejected' | 'pending' = 'pending';

  constructor(
    executor: (
      resolve: (value: T | PromiseLike<T>) => void,
      reject: (reason?: unknown) => void,
    ) => void = () => null,
  ) {
    let _resolve: ((value: T | PromiseLike<T>) => void) | undefined = undefined;
    let _reject: ((reason?: unknown) => void) | undefined = undefined;

    super((resolve, reject) => {
      executor(resolve, reject);
      _resolve = resolve;
      _reject = reject;
    });

    assert(_resolve);
    assert(_reject);

    this._resolve = _resolve;
    this._reject = _reject;
  }

  reject(reason?: unknown): void {
    this._state = 'rejected';
    this._reject(reason);
  }

  resolve(value?: T): void {
    this._state = 'resolved';
    this._resolve(value as T);
  }

  get isResolved() {
    return this._state === 'resolved';
  }

  get isRejected() {
    return this._state === 'rejected';
  }

  get isPending() {
    return this._state === 'pending';
  }

  static resolved<R = unknown>(value?: R) {
    const promise = new CancellationPromise<R>();
    promise.resolve(value as R);
    return promise;
  }

  static rejected<R extends Error = Error>(value: R) {
    const promise = new CancellationPromise<R>();
    promise.reject(value);
    return promise;
  }
}
