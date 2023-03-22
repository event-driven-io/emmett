export interface EventStore {
  type: 'postgres' | 'sqlite' | 'inmemory';
  init: () => Promise<void>;
  diagnostics: {
    ping: () => Promise<'pong'>;
  };
}
