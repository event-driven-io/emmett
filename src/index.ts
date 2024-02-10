export interface EventStore {
  appendEvents: () => Promise<void>;
}
