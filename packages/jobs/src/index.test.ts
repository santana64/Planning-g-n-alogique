import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { reportConnectionErrors } from './index';

describe('reportConnectionErrors', () => {
  it('reports the first failure, then one per interval with the count left out', () => {
    const emitter = new EventEmitter();
    const reports: Array<[string, number]> = [];
    let clock = 0;
    reportConnectionErrors(
      emitter,
      (error, suppressed) => reports.push([error.message, suppressed]),
      60_000,
      () => clock,
    );

    for (let second = 0; second < 150; second += 2) {
      clock = second * 1000;
      emitter.emit('error', new Error(`retry at ${second}s`));
    }

    expect(reports).toEqual([
      ['retry at 0s', 0],
      ['retry at 60s', 29],
      ['retry at 120s', 29],
    ]);
  });

  it('keeps an unhandled error from reaching the emitter default', () => {
    const emitter = new EventEmitter();
    reportConnectionErrors(emitter, () => undefined);
    expect(() => emitter.emit('error', new Error('ECONNREFUSED'))).not.toThrow();
  });
});
