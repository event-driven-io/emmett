export type Closeable = {
  /**
   * Gracefully cleans up managed resources
   *
   * @memberof Closeable
   */
  close: () => Promise<void>;
};
