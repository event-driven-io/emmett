import { assertDeepEqual } from '@event-driven-io/emmett';
import { type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { MongoClient } from 'mongodb';
import { after, before, describe, it } from 'node:test';
import {
  readProcessorCheckpoint,
  storeProcessorCheckpoint,
} from './mongoDBCheckpointer';
import {
  toMongoDBCheckpoint,
  type MongoDBCheckpoint,
} from './subscriptions/mongoDBCheckpoint';
import { getMongoDBStartedContainer } from '@event-driven-io/emmett-testcontainers';

void describe('storeProcessorCheckpoint and readProcessorCheckpoint tests', () => {
  let mongodb: StartedMongoDBContainer;
  let client: MongoClient;

  const processorId = 'processorId-1';
  const resumeToken1: MongoDBCheckpoint = toMongoDBCheckpoint(
    {
      _data:
        '82687E948D000000032B042C0100296E5A100461BBC0449CFA4531AE298EB6083F923A463C6F7065726174696F6E54797065003C696E736572740046646F63756D656E744B65790046645F69640064687E948DC5FE3CA1AF560962000004',
    },
    undefined,
  );
  const resumeToken2: MongoDBCheckpoint = toMongoDBCheckpoint(
    {
      _data:
        '82687E949E000000012B042C0100296E5A100461BBC0449CFA4531AE298EB6083F923A463C6F7065726174696F6E54797065003C7570646174650046646F63756D656E744B65790046645F69640064687E948DC5FE3CA1AF560962000004',
    },
    1,
  );
  const resumeToken3: MongoDBCheckpoint = toMongoDBCheckpoint(
    {
      _data:
        '82687E94D4000000012B042C0100296E5A100461BBC0449CFA4531AE298EB6083F923A463C6F7065726174696F6E54797065003C7570646174650046646F63756D656E744B65790046645F69640064687E948DC5FE3CA1AF560962000004',
    },
    2,
  );
  before(async () => {
    mongodb = await getMongoDBStartedContainer();
    client = new MongoClient(mongodb.getConnectionString(), {
      directConnection: true,
    });

    await client.connect();
  });

  after(async () => {
    await client.close();
    await mongodb.stop();
  });

  void it('should store successfully last proceeded MongoDB resume token for the first time', async () => {
    const result = await storeProcessorCheckpoint(client, {
      processorId,
      lastStoredCheckpoint: null,
      newCheckpoint: resumeToken1,
      version: 1,
    });

    assertDeepEqual(result, {
      success: true,
      newCheckpoint: resumeToken1,
    });
  });

  void it('should store successfully a new checkpoint expecting the previous token', async () => {
    const result = await storeProcessorCheckpoint(client, {
      processorId,
      lastStoredCheckpoint: resumeToken1,
      newCheckpoint: resumeToken2,
      version: 2,
    });

    assertDeepEqual(result, {
      success: true,
      newCheckpoint: resumeToken2,
    });
  });

  void it('it returns IGNORED when the newCheckpoint is the same or earlier than the lastProcessedPosition', async () => {
    const result = await storeProcessorCheckpoint(client, {
      processorId,
      lastStoredCheckpoint: resumeToken2,
      newCheckpoint: resumeToken1,
      version: 3,
    });

    assertDeepEqual(result, {
      success: false,
      reason: 'IGNORED',
    });
  });

  void it('it returns MISMATCH when the lastProcessedPosition is not the one that is currently stored', async () => {
    const result = await storeProcessorCheckpoint(client, {
      processorId,
      lastStoredCheckpoint: resumeToken1,
      newCheckpoint: resumeToken3,
      version: 3,
    });

    assertDeepEqual(result, {
      success: false,
      reason: 'MISMATCH',
    });
  });

  void it('it can save a checkpoint with a specific partition', async () => {
    const result = await storeProcessorCheckpoint(client, {
      processorId,
      lastStoredCheckpoint: null,
      newCheckpoint: resumeToken1,
      partition: 'partition-2',
      version: 1,
    });

    assertDeepEqual(result, {
      success: true,
      newCheckpoint: resumeToken1,
    });
  });

  void it('it can read a position of a processor with the default partition', async () => {
    const result = await readProcessorCheckpoint(client, {
      processorId,
    });

    assertDeepEqual(result, { lastCheckpoint: resumeToken2 });
  });

  void it('it can read a position of a processor with a defined partition', async () => {
    const result = await readProcessorCheckpoint(client, {
      processorId,
      partition: 'partition-2',
    });

    assertDeepEqual(result, { lastCheckpoint: resumeToken1 });
  });
});
