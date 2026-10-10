import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import pg from 'pg';

/**
 * A work queue kept in PostgreSQL, for the desktop edition.
 *
 * A computer running the application on its own has no Redis, and starting
 * one for a single user's imports would be a second database to install,
 * secure and keep running. The queue's needs here are modest — a handful of
 * jobs, one worker — and PostgreSQL already does exactly what they need:
 * `FOR UPDATE SKIP LOCKED` lets a worker take a job no other worker holds,
 * and a row survives a crash, so a job is never lost with the process.
 *
 * It honours the part of BullMQ's contract the application uses: `add` with
 * a job id that makes a second add a no-op, `getJob` with a state, `remove`,
 * bounded attempts with exponential backoff, and a worker with a concurrency
 * and a `failed` event. The tables live in their own schema, out of Prisma's
 * way: they are infrastructure, not part of the family's data.
 */

const SCHEMA = 'chronolignee_jobs';
const POLL_MS = 500;
const BACKOFF_MS = 5_000;
const KEEP_COMPLETED_MS = 86_400_000;
const KEEP_FAILED_MS = 604_800_000;

export type JobState = 'waiting' | 'delayed' | 'active' | 'completed' | 'failed';

export interface QueuedJob {
  readonly id: string;
  readonly name: string;
  readonly data: unknown;
}

export interface AddOptions {
  readonly jobId?: string;
  readonly attempts?: number;
}

const pools = new Map<string, pg.Pool>();
const ready = new Map<string, Promise<void>>();

function poolFor(databaseUrl: string): pg.Pool {
  let pool = pools.get(databaseUrl);
  if (!pool) {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
    pools.set(databaseUrl, pool);
  }
  return pool;
}

/** Create the queue's tables once per process; safe to race with another process. */
function ensureSchema(databaseUrl: string): Promise<void> {
  let promise = ready.get(databaseUrl);
  if (!promise) {
    promise = poolFor(databaseUrl)
      .query(
        `CREATE SCHEMA IF NOT EXISTS ${SCHEMA};
         CREATE TABLE IF NOT EXISTS ${SCHEMA}.jobs (
           id text PRIMARY KEY,
           queue text NOT NULL,
           name text NOT NULL,
           data jsonb NOT NULL,
           state text NOT NULL DEFAULT 'waiting',
           attempts integer NOT NULL DEFAULT 0,
           max_attempts integer NOT NULL DEFAULT 1,
           run_at timestamptz NOT NULL DEFAULT now(),
           error text,
           created_at timestamptz NOT NULL DEFAULT now(),
           finished_at timestamptz
         );
         CREATE INDEX IF NOT EXISTS jobs_ready ON ${SCHEMA}.jobs (queue, state, run_at);`,
      )
      .then(() => undefined);
    ready.set(databaseUrl, promise);
  }
  return promise;
}

export class PostgresQueue extends EventEmitter {
  constructor(
    private readonly name: string,
    private readonly databaseUrl: string,
  ) {
    super();
  }

  async add(jobName: string, data: unknown, options: AddOptions = {}): Promise<void> {
    await ensureSchema(this.databaseUrl);
    // A second add with the same id is ignored, as BullMQ does.
    await poolFor(this.databaseUrl).query(
      `INSERT INTO ${SCHEMA}.jobs (id, queue, name, data, max_attempts)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [
        options.jobId ?? randomUUID(),
        this.name,
        jobName,
        JSON.stringify(data),
        options.attempts ?? 1,
      ],
    );
  }

  async getJob(id: string) {
    await ensureSchema(this.databaseUrl);
    const pool = poolFor(this.databaseUrl);
    const { rows } = await pool.query<{ state: JobState; run_at: Date }>(
      `SELECT state, run_at FROM ${SCHEMA}.jobs WHERE id = $1 AND queue = $2`,
      [id, this.name],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id,
      getState: async (): Promise<JobState> =>
        row.state === 'waiting' && row.run_at.getTime() > Date.now() ? 'delayed' : row.state,
      remove: async (): Promise<void> => {
        await pool.query(`DELETE FROM ${SCHEMA}.jobs WHERE id = $1 AND queue = $2`, [
          id,
          this.name,
        ]);
      },
    };
  }

  async close(): Promise<void> {
    // The pool is shared by every queue of the process and closed with it.
  }
}

export class PostgresWorker extends EventEmitter {
  private stopped = false;
  private readonly loops: Promise<void>[] = [];
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly name: string,
    private readonly processor: (job: QueuedJob) => Promise<unknown>,
    private readonly databaseUrl: string,
    concurrency = 1,
  ) {
    super();
    void this.start(concurrency);
  }

  private async start(concurrency: number): Promise<void> {
    try {
      await ensureSchema(this.databaseUrl);
      // A job left active by a process that died is taken up again: one
      // desktop worker per database, so nothing else can be running it.
      await poolFor(this.databaseUrl).query(
        `UPDATE ${SCHEMA}.jobs SET state = 'waiting' WHERE queue = $1 AND state = 'active'`,
        [this.name],
      );
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
    for (let i = 0; i < concurrency; i += 1) this.loops.push(this.loop());
    this.sweeper = setInterval(() => void this.sweep(), 3_600_000);
  }

  private async claim(): Promise<(QueuedJob & { attempts: number; maxAttempts: number }) | null> {
    const { rows } = await poolFor(this.databaseUrl).query<{
      id: string;
      name: string;
      data: unknown;
      attempts: number;
      max_attempts: number;
    }>(
      `UPDATE ${SCHEMA}.jobs SET state = 'active', attempts = attempts + 1
       WHERE id = (
         SELECT id FROM ${SCHEMA}.jobs
         WHERE queue = $1 AND state = 'waiting' AND run_at <= now()
         ORDER BY run_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING id, name, data, attempts, max_attempts`,
      [this.name],
    );
    const row = rows[0];
    return row
      ? {
          id: row.id,
          name: row.name,
          data: row.data,
          attempts: row.attempts,
          maxAttempts: row.max_attempts,
        }
      : null;
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      let job: Awaited<ReturnType<PostgresWorker['claim']>> = null;
      try {
        job = await this.claim();
      } catch (error) {
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      }
      if (!job) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        continue;
      }
      const pool = poolFor(this.databaseUrl);
      try {
        await this.processor(job);
        await pool.query(
          `UPDATE ${SCHEMA}.jobs SET state = 'completed', finished_at = now(), error = NULL WHERE id = $1`,
          [job.id],
        );
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        const retry = job.attempts < job.maxAttempts;
        // The error's type only: its message may quote a value from a
        // private document, and this table is not a log anyone reviews.
        await pool
          .query(
            retry
              ? `UPDATE ${SCHEMA}.jobs SET state = 'waiting', error = $2,
                   run_at = now() + ($3 || ' milliseconds')::interval WHERE id = $1`
              : `UPDATE ${SCHEMA}.jobs SET state = 'failed', error = $2, finished_at = now() WHERE id = $1`,
            retry
              ? [job.id, failure.name, String(BACKOFF_MS * 2 ** (job.attempts - 1))]
              : [job.id, failure.name],
          )
          .catch(() => undefined);
        if (!retry) this.emit('failed', job, failure);
      }
    }
  }

  private async sweep(): Promise<void> {
    await poolFor(this.databaseUrl)
      .query(
        `DELETE FROM ${SCHEMA}.jobs WHERE queue = $1 AND (
           (state = 'completed' AND finished_at < now() - ($2 || ' milliseconds')::interval) OR
           (state = 'failed' AND finished_at < now() - ($3 || ' milliseconds')::interval))`,
        [this.name, String(KEEP_COMPLETED_MS), String(KEEP_FAILED_MS)],
      )
      .catch(() => undefined);
  }

  isRunning(): boolean {
    return !this.stopped;
  }

  async close(): Promise<void> {
    this.stopped = true;
    if (this.sweeper) clearInterval(this.sweeper);
    await Promise.all(this.loops);
  }
}

/** Close every connection the queues of this process opened. */
export async function closePostgresQueues(): Promise<void> {
  await Promise.all([...pools.values()].map((pool) => pool.end()));
  pools.clear();
  ready.clear();
}
