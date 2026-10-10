import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  documentAnalysisJobId,
  duplicateScanJobId,
  reportConnectionErrors,
  researchAssistJobId,
} from './index';

describe('duplicateScanJobId', () => {
  it('is one id per tree, and never one BullMQ refuses', () => {
    const id = '0198f3a0-1c2d-7a3b-8c4d-5e6f70819a2b';
    expect(duplicateScanJobId(id)).toBe(`scan-${id}`);
    expect(duplicateScanJobId(id)).not.toContain(':');
  });
});

describe('the other job ids', () => {
  it('never contain the colon BullMQ refuses', () => {
    const id = '0198f3a0-1c2d-7a3b-8c4d-5e6f70819a2b';
    expect(documentAnalysisJobId(id)).toBe(`read-${id}`);
    expect(researchAssistJobId(id)).toBe(`assist-${id}`);
    expect(`${documentAnalysisJobId(id)}${researchAssistJobId(id)}`).not.toContain(':');
  });
});

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
