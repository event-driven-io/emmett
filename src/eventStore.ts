export interface EventStore {
  type: 'postgres' | 'sqlite' | 'inmemory';
  close: () => Promise<void>;
  init: () => Promise<void>;
  diagnostics: {
    ping: () => Promise<'pong'>;
  };
}
