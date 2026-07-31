import type { subscribe } from './esdbSubscription';

type Subscription = ReturnType<typeof subscribe>;

export const observeSubscriptionEvents = (
  subscription: Subscription,
  signal: AbortSignal,
) => {
  let confirmed = false;
  let caughtUpPending = false;
  let ended = false;
  let failure: Error | undefined;

  let eventPending = false;
  let eventWaiter: (() => void) | null = null;

  const notify = (): void => {
    if (eventWaiter) {
      const resolve = eventWaiter;
      eventWaiter = null;
      resolve();
      return;
    }

    eventPending = true;
  };

  const waitForEvent = (): Promise<void> => {
    if (eventPending) {
      eventPending = false;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      eventWaiter = resolve;
    });
  };

  const onConfirmation = () => {
    confirmed = true;
    notify();
  };

  const onCaughtUp = () => {
    caughtUpPending = true;
    notify();
  };

  const onFellBehind = () => {
    caughtUpPending = false;
    notify();
  };

  const onReadable = () => {
    notify();
  };

  const onEnd = () => {
    ended = true;
    notify();
  };

  const onError = (error: Error) => {
    failure = error;
    notify();
  };

  const onAbort = () => {
    notify();
  };

  subscription.on('confirmation', onConfirmation);
  subscription.on('caughtUp', onCaughtUp);
  subscription.on('fellBehind', onFellBehind);
  subscription.on('readable', onReadable);
  subscription.on('end', onEnd);
  subscription.on('error', onError);
  signal.addEventListener('abort', onAbort, { once: true });

  return {
    get confirmed() {
      return confirmed;
    },

    get ended() {
      return ended;
    },

    get failure() {
      return failure;
    },

    takeCaughtUp(): boolean {
      if (!caughtUpPending) {
        return false;
      }

      caughtUpPending = false;
      return true;
    },

    waitForNotification: waitForEvent,

    async dispose(): Promise<void> {
      signal.removeEventListener('abort', onAbort);

      await subscription
        .unsubscribe()
        .catch(() => {})
        .finally(() => {
          subscription.destroy();
          subscription.off('confirmation', onConfirmation);
          subscription.off('caughtUp', onCaughtUp);
          subscription.off('fellBehind', onFellBehind);
          subscription.off('readable', onReadable);
          subscription.off('end', onEnd);
          subscription.off('error', onError);
        });
    },
  };
};
