import type { MongoClient } from 'mongodb';
import type { Closeable } from '@event-driven-io/emmett';
import {
  type MongoDBEventAsDocumentEventStore,
  type MongoDBEventAsDocumentEventStoreOptions,
} from './eventAsDocument';
import {
  type MongoDBStreamAsDocumentEventStore,
  type MongoDBStreamAsDocumentEventStoreOptions,
  MongoDBStreamAsDocumentEventStoreImplementation,
} from './streamAsDocument';

export type MongoDBEventStoreOptions =
  | ({
      /**
       * Each event stream will be stored as its own document. The events will be stored in
       * an array within the document.
       */
      documentType: 'stream';
    } & MongoDBStreamAsDocumentEventStoreOptions)
  | ({
      /**
       * TODO: not implemented yet.
       * Each event will be its own document.
       */
      documentType: 'event';
    } & MongoDBEventAsDocumentEventStoreOptions);

export function getMongoDBEventStore(
  options: MongoDBEventStoreOptions & {
    documentType: 'stream';
    client: MongoClient;
  },
): MongoDBStreamAsDocumentEventStore;
export function getMongoDBEventStore(
  options: MongoDBEventStoreOptions & {
    documentType: 'stream';
    connectionString: string;
  },
): MongoDBStreamAsDocumentEventStore & Closeable;

export function getMongoDBEventStore(
  options: MongoDBEventStoreOptions & {
    documentType: 'event';
    client: MongoClient;
  },
): MongoDBEventAsDocumentEventStore;

export function getMongoDBEventStore(
  options: MongoDBEventStoreOptions & {
    documentType: 'event';
    connectionString: string;
  },
): MongoDBEventAsDocumentEventStore & Closeable;

// Implementation signature covers both, using a union for `options`
export function getMongoDBEventStore(
  options: MongoDBEventStoreOptions,
):
  | MongoDBStreamAsDocumentEventStore
  | MongoDBEventAsDocumentEventStore
  | Closeable {
  if (options.documentType === 'stream') {
    const impl = new MongoDBStreamAsDocumentEventStoreImplementation(options);

    // If a client is provided externally, we don't want to allow closing it
    if ('client' in options && 'close' in impl) {
      delete (impl as Partial<MongoDBStreamAsDocumentEventStoreImplementation>)
        .close;
    }
    return impl;
  }

  throw new Error('MongoDBEventAsDocumentEventStore not implemented');
}
