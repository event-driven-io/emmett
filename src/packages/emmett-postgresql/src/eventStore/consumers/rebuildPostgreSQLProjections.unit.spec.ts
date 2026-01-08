import { assertEqual, assertOk } from '@event-driven-io/emmett';
import { describe, it } from 'node:test';
import { v7 as uuid } from 'uuid';
import { rebuildPostgreSQLProjections } from './rebuildPostgreSQLProjections';

void describe('rebuildPostgreSQLProjections', () => {
  const dummyConnectionString = 'postgres://localhost:5432/dummy';

  void describe('single projection via projection option', () => {
    void it('should create consumer with single processor', () => {
      // Given
      const projectionName = `projection_${uuid()}`;

      // When
      const consumer = rebuildPostgreSQLProjections({
        connectionString: dummyConnectionString,
        projection: {
          name: projectionName,
          canHandle: [],
          handle: () => Promise.resolve(),
        },
      });

      // Then
      assertEqual(consumer.processors.length, 1);
    });

    void it('should generate processorId from projection name', () => {
      // Given
      const projectionName = `projection_${uuid()}`;

      // When
      const consumer = rebuildPostgreSQLProjections({
        connectionString: dummyConnectionString,
        projection: {
          name: projectionName,
          canHandle: [],
          handle: () => Promise.resolve(),
        },
      });

      // Then
      // Single projection option uses different format than projections array
      assertEqual(consumer.processors[0]!.id, `projection:${projectionName}`);
    });

    void it('should set processor type to projector', () => {
      // Given
      const projectionName = `projection_${uuid()}`;

      // When
      const consumer = rebuildPostgreSQLProjections({
        connectionString: dummyConnectionString,
        projection: {
          name: projectionName,
          canHandle: [],
          handle: () => Promise.resolve(),
        },
      });

      // Then
      assertEqual(consumer.processors[0]!.type, 'projector');
    });
  });

  void describe('multiple projections via projections option', () => {
    void it('should create consumer with multiple processors for projection definitions', () => {
      // Given
      const projection1Name = `projection1_${uuid()}`;
      const projection2Name = `projection2_${uuid()}`;

      // When
      const consumer = rebuildPostgreSQLProjections({
        connectionString: dummyConnectionString,
        projections: [
          {
            name: projection1Name,
            canHandle: [],
            handle: () => Promise.resolve(),
          },
          {
            name: projection2Name,
            canHandle: [],
            handle: () => Promise.resolve(),
          },
        ],
      });

      // Then
      assertEqual(consumer.processors.length, 2);
      assertEqual(
        consumer.processors[0]!.id,
        `emt:processor:projector:${projection1Name}`,
      );
      assertEqual(
        consumer.processors[1]!.id,
        `emt:processor:projector:${projection2Name}`,
      );
    });

    void it('should create consumer with multiple processors for projector options', () => {
      // Given
      const projection1Name = `projection1_${uuid()}`;
      const projection2Name = `projection2_${uuid()}`;

      // When
      const consumer = rebuildPostgreSQLProjections({
        connectionString: dummyConnectionString,
        projections: [
          {
            projection: {
              name: projection1Name,
              canHandle: [],
              handle: () => Promise.resolve(),
            },
          },
          {
            projection: {
              name: projection2Name,
              canHandle: [],
              handle: () => Promise.resolve(),
            },
          },
        ],
      });

      // Then
      assertEqual(consumer.processors.length, 2);
      assertEqual(
        consumer.processors[0]!.id,
        `emt:processor:projector:${projection1Name}`,
      );
      assertEqual(
        consumer.processors[1]!.id,
        `emt:processor:projector:${projection2Name}`,
      );
    });

    void it('should handle mixed projection definitions and projector options', () => {
      // Given
      const projection1Name = `projection1_${uuid()}`;
      const projection2Name = `projection2_${uuid()}`;

      // When
      const consumer = rebuildPostgreSQLProjections({
        connectionString: dummyConnectionString,
        projections: [
          {
            name: projection1Name,
            canHandle: [],
            handle: () => Promise.resolve(),
          },
          {
            projection: {
              name: projection2Name,
              canHandle: [],
              handle: () => Promise.resolve(),
            },
          },
        ],
      });

      // Then
      assertEqual(consumer.processors.length, 2);
      assertEqual(
        consumer.processors[0]!.id,
        `emt:processor:projector:${projection1Name}`,
      );
      assertEqual(
        consumer.processors[1]!.id,
        `emt:processor:projector:${projection2Name}`,
      );
    });
  });

  void describe('custom processorId', () => {
    void it('should use custom processorId when provided in projector options', () => {
      // Given
      const projectionName = `projection_${uuid()}`;
      const customProcessorId = `custom:processor:${uuid()}`;

      // When
      const consumer = rebuildPostgreSQLProjections({
        connectionString: dummyConnectionString,
        projections: [
          {
            processorId: customProcessorId,
            projection: {
              name: projectionName,
              canHandle: [],
              handle: () => Promise.resolve(),
            },
          },
        ],
      });

      // Then
      assertEqual(consumer.processors[0]!.id, customProcessorId);
    });
  });

  void describe('consumer configuration', () => {
    void it('should expose projector method on consumer', () => {
      // Given
      const projectionName = `projection_${uuid()}`;

      // When
      const consumer = rebuildPostgreSQLProjections({
        connectionString: dummyConnectionString,
        projection: {
          name: projectionName,
          canHandle: [],
          handle: () => Promise.resolve(),
        },
      });

      // Then
      assertOk(typeof consumer.projector === 'function');
    });

    void it('should expose reactor method on consumer', () => {
      // Given
      const projectionName = `projection_${uuid()}`;

      // When
      const consumer = rebuildPostgreSQLProjections({
        connectionString: dummyConnectionString,
        projection: {
          name: projectionName,
          canHandle: [],
          handle: () => Promise.resolve(),
        },
      });

      // Then
      assertOk(typeof consumer.reactor === 'function');
    });

    void it('should generate unique consumerId', () => {
      // Given
      const projectionName = `projection_${uuid()}`;

      // When
      const consumer1 = rebuildPostgreSQLProjections({
        connectionString: dummyConnectionString,
        projection: {
          name: projectionName,
          canHandle: [],
          handle: () => Promise.resolve(),
        },
      });

      const consumer2 = rebuildPostgreSQLProjections({
        connectionString: dummyConnectionString,
        projection: {
          name: projectionName,
          canHandle: [],
          handle: () => Promise.resolve(),
        },
      });

      // Then
      assertOk(
        typeof consumer1.consumerId === 'string' &&
          consumer1.consumerId.length > 0,
      );
      assertOk(consumer1.consumerId !== consumer2.consumerId);
    });

    void it('should use provided consumerId', () => {
      // Given
      const projectionName = `projection_${uuid()}`;
      const customConsumerId = `consumer_${uuid()}`;

      // When
      const consumer = rebuildPostgreSQLProjections({
        connectionString: dummyConnectionString,
        consumerId: customConsumerId,
        projection: {
          name: projectionName,
          canHandle: [],
          handle: () => Promise.resolve(),
        },
      });

      // Then
      assertEqual(consumer.consumerId, customConsumerId);
    });
  });

  void describe('processor instance uniqueness', () => {
    void it('should generate unique instanceId for each processor', () => {
      // Given
      const projection1Name = `projection_${uuid()}`;
      const projection2Name = `projection_${uuid()}`;

      // When
      const consumer = rebuildPostgreSQLProjections({
        connectionString: dummyConnectionString,
        projections: [
          {
            name: projection1Name,
            canHandle: [],
            handle: () => Promise.resolve(),
          },
          {
            name: projection2Name,
            canHandle: [],
            handle: () => Promise.resolve(),
          },
        ],
      });

      // Then
      const instanceId1 = consumer.processors[0]!.instanceId;
      const instanceId2 = consumer.processors[1]!.instanceId;
      assertOk(instanceId1 !== instanceId2);
    });
  });
});
