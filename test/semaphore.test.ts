import { describe, it, expect } from 'vitest';

import { createSemaphore } from '../src/semaphore.js';

/** Resolves after `ms`, using real timers. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('createSemaphore', () => {
  it('never exceeds the limit', async () => {
    const semaphore = createSemaphore(3);

    let inFlight = 0;
    let observedMax = 0;

    await Promise.all(
      Array.from({ length: 12 }, () =>
        semaphore.run(async () => {
          inFlight++;
          observedMax = Math.max(observedMax, inFlight);
          await delay(5);
          inFlight--;
        })
      )
    );

    expect(observedMax).toBe(3);
    expect(inFlight).toBe(0);
  });

  it('runs every task', async () => {
    const semaphore = createSemaphore(2);
    const order: number[] = [];

    await Promise.all(
      Array.from({ length: 6 }, (_unused, i) =>
        semaphore.run(async () => {
          await delay(1);
          order.push(i);
        })
      )
    );

    expect(order).toHaveLength(6);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('returns each task result', async () => {
    const semaphore = createSemaphore(2);

    const results = await Promise.all(
      [1, 2, 3, 4].map((n) => semaphore.run(async () => n * 2))
    );

    expect(results).toEqual([2, 4, 6, 8]);
  });

  it('releases the slot when a task rejects', async () => {
    const semaphore = createSemaphore(1);

    await expect(
      semaphore.run(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    // If the slot leaked, this would never settle.
    await expect(semaphore.run(async () => 'still works')).resolves.toBe(
      'still works'
    );
  });

  it('keeps draining the queue after a rejection', async () => {
    const semaphore = createSemaphore(1);

    const results = await Promise.allSettled([
      semaphore.run(async () => {
        await delay(2);
        throw new Error('first fails');
      }),
      semaphore.run(async () => 'second'),
      semaphore.run(async () => 'third'),
    ]);

    expect(results[0]!.status).toBe('rejected');
    expect(results[1]).toEqual({ status: 'fulfilled', value: 'second' });
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'third' });
  });

  it.each([0, -1, 0.4, Number.NaN])(
    'floors a limit of %p to serial execution',
    async (limit) => {
      const semaphore = createSemaphore(limit);

      let inFlight = 0;
      let observedMax = 0;

      await Promise.all(
        Array.from({ length: 4 }, () =>
          semaphore.run(async () => {
            inFlight++;
            observedMax = Math.max(observedMax, inFlight);
            await delay(1);
            inFlight--;
          })
        )
      );

      expect(observedMax).toBe(1);
    }
  );

  it('truncates a fractional limit', async () => {
    const semaphore = createSemaphore(2.9);

    let inFlight = 0;
    let observedMax = 0;

    await Promise.all(
      Array.from({ length: 6 }, () =>
        semaphore.run(async () => {
          inFlight++;
          observedMax = Math.max(observedMax, inFlight);
          await delay(2);
          inFlight--;
        })
      )
    );

    expect(observedMax).toBe(2);
  });
});
