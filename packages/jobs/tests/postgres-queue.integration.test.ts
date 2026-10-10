import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { PostgresQueue, PostgresWorker, closePostgresQueues } from '../src/index';

/**
 * The desktop edition's queue, against the real PostgreSQL.
 *
 * What it must keep from BullMQ: a job id that makes a second add a no-op, a
 * state a caller can read, retries that stop, and a worker that takes each
 * job once.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

const url = process.env['DATABASE_URL'] ?? '';
const unique = () => `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const until = async (check: () => Promise<boolean>, timeoutMs = 15_000) => {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

afterAll(async () => {
  await closePostgresQueues();
});

describe('a queue kept in PostgreSQL', () => {
  it('ignores a second add with the same id, and runs the job once', async () => {
    const name = unique();
    const queue = new PostgresQueue(name, url);
    await queue.add('scan', { n: 1 }, { jobId: 'only-one' });
    await queue.add('scan', { n: 2 }, { jobId: 'only-one' });
    expect(await (await queue.getJob('only-one'))?.getState()).toBe('waiting');

    const seen: unknown[] = [];
    const worker = new PostgresWorker(name, async (job) => void seen.push(job.data), url, 2);
    await until(async () => (await (await queue.getJob('only-one'))?.getState()) === 'completed');
    await worker.close();
    expect(seen).toEqual([{ n: 1 }]);
  });

  it('retries a failing job, then gives up and says so', async () => {
    const name = unique();
    const queue = new PostgresQueue(name, url);
    await queue.add('derive', {}, { jobId: 'fails', attempts: 2 });
    let runs = 0;
    const failures: string[] = [];
    const worker = new PostgresWorker(
      name,
      async () => {
        runs += 1;
        throw new TypeError('corrupt image');
      },
      url,
    );
    worker.on('failed', (_job: unknown, error: Error) => failures.push(error.name));
    // The first failure is retried after its backoff; the test does not wait
    // five seconds for it, it only checks the job is held back.
    await until(async () => runs === 1);
    await until(async () => {
      const state = await (await queue.getJob('fails'))?.getState();
      return state === 'delayed';
    });
    await worker.close();
    expect(failures).toEqual([]);
  });

  it('marks a job failed after its last attempt, and can remove it', async () => {
    const name = unique();
    const queue = new PostgresQueue(name, url);
    await queue.add('import', {}, { jobId: 'once', attempts: 1 });
    const failures: string[] = [];
    const worker = new PostgresWorker(
      name,
      async () => {
        throw new RangeError('bad file');
      },
      url,
    );
    worker.on('failed', (_job: unknown, error: Error) => failures.push(error.name));
    await until(async () => (await (await queue.getJob('once'))?.getState()) === 'failed');
    await worker.close();
    expect(failures).toEqual(['RangeError']);

    await (await queue.getJob('once'))?.remove();
    expect(await queue.getJob('once')).toBeNull();
  });
});
