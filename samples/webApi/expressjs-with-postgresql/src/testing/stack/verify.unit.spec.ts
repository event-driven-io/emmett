import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runVerifications, verify } from './verify';

void describe('verify', () => {
  void it('returns the name and run untouched', () => {
    const run = async (): Promise<void> => {};
    const v = verify('checks something', run);

    assert.equal(v.name, 'checks something');
    assert.equal(v.run, run);
  });

  void it('runs the array in declaration order', async () => {
    const order: string[] = [];
    const group = [
      verify('first', () => {
        order.push('first');
      }),
      verify('second', () => {
        order.push('second');
      }),
    ];

    await runVerifications(group)();

    assert.deepEqual(order, ['first', 'second']);
  });

  void it('accepts a synchronous run (sync or async)', async () => {
    let ran = false;
    const group = [
      verify('sync check', () => {
        ran = true;
      }),
    ];

    await runVerifications(group)();

    assert.equal(ran, true);
  });
});
