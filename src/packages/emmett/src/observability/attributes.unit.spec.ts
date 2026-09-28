import { describe, expect, it } from 'vitest';
import { MessagingAttributes } from '@event-driven-io/almanac';
import { EmmettAttributes, EmmettMetrics, EmmettSpans } from './attributes';

const collectLeafValues = (obj: Record<string, unknown>): string[] => {
  const values: string[] = [];
  for (const value of Object.values(obj)) {
    if (typeof value === 'string') {
      values.push(value);
    } else if (typeof value === 'object' && value !== null) {
      values.push(...collectLeafValues(value as Record<string, unknown>));
    }
  }
  return values;
};

describe('EmmettAttributes', () => {
  it('all leaf values are prefixed with emmett.', () => {
    const values = collectLeafValues(EmmettAttributes);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).toMatch(/^emmett\./);
    }
  });
});

describe('EmmettAttributes for processor and consumer lifecycle logs', () => {
  it('names consumer, processor instance, lock, start and stream position attributes', () => {
    expect({
      consumerId: EmmettAttributes.consumer.id,
      instanceId: EmmettAttributes.processor.instanceId,
      lockKey: EmmettAttributes.processor.lock.key,
      startFrom: EmmettAttributes.processor.startFrom,
      checkpoint: EmmettAttributes.processor.checkpoint,
      streamPosition: EmmettAttributes.stream.position,
    }).toEqual({
      consumerId: 'emmett.consumer.id',
      instanceId: 'emmett.processor.instance_id',
      lockKey: 'emmett.processor.lock.key',
      startFrom: 'emmett.processor.start_from',
      checkpoint: 'emmett.processor.checkpoint',
      streamPosition: 'emmett.stream.position',
    });
  });
});

describe('EmmettSpans', () => {
  it('names processor, consumer and event store lifecycle spans', () => {
    expect(EmmettSpans).toEqual({
      processor: {
        start: 'emmett.processor.start',
        acquireLock: 'emmett.processor.acquire_lock',
        onStart: 'emmett.processor.hooks.on_start',
        readCheckpoint: 'emmett.processor.read_checkpoint',
        close: 'emmett.processor.close',
        releaseLock: 'emmett.processor.release_lock',
      },
      consumer: {
        start: 'emmett.consumer.start',
        stop: 'emmett.consumer.stop',
      },
      eventStore: {
        onAfterCommit: 'emmett.eventstore.hooks.on_after_commit',
      },
    });
  });
});

describe('MessagingAttributes', () => {
  it('all values are prefixed with messaging.', () => {
    const values = collectLeafValues(MessagingAttributes);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).toMatch(/^messaging\./);
    }
  });
});

describe('EmmettMetrics', () => {
  it('all leaf values are prefixed with emmett.', () => {
    const values = collectLeafValues(EmmettMetrics);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).toMatch(/^emmett\./);
    }
  });
});

describe('no duplicate values', () => {
  it('within EmmettAttributes', () => {
    const values = collectLeafValues(EmmettAttributes);
    expect(new Set(values).size).toBe(values.length);
  });

  it('within EmmettMetrics', () => {
    const values = collectLeafValues(EmmettMetrics);
    expect(new Set(values).size).toBe(values.length);
  });

  it('within MessagingAttributes', () => {
    const values = collectLeafValues(MessagingAttributes);
    expect(new Set(values).size).toBe(values.length);
  });
});
