/**
 * A concurrency gate: at most `limit` tasks run at once, the rest queue.
 *
 * Sätteri enters every matched node's visitor synchronously and only then
 * awaits the returned promises together, so an async visitor that fetches
 * would otherwise issue one request per link with no upper bound. This is the
 * plugin's own limiter.
 */
export interface Semaphore {
  /** Runs `fn` once a slot is free, releasing the slot when it settles. */
  run<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Creates a {@link Semaphore} allowing `limit` concurrent tasks.
 *
 * `limit` is floored at 1, so `0`, negative and `NaN` values degrade to
 * fully serial execution rather than deadlocking.
 */
export function createSemaphore(limit: number): Semaphore {
  const max = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1;

  let active = 0;
  const queue: (() => void)[] = [];

  function release(): void {
    active--;
    const next = queue.shift();
    if (next) next();
  }

  function acquire(): Promise<void> {
    if (active < max) {
      active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      queue.push(() => {
        active++;
        resolve();
      });
    });
  }

  return {
    async run(fn) {
      await acquire();
      try {
        return await fn();
      } finally {
        // Always release, so a rejecting task cannot wedge the gate.
        release();
      }
    },
  };
}
