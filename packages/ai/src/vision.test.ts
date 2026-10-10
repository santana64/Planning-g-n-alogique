import { deflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { AnthropicProvider, type ExtractionClient } from './anthropic-provider';
import { FakeAIProvider, pdfText, pngText } from './fake-provider';
import { ExtractionError } from './provider';
import { SCAN_SYSTEM_PROMPT } from './prompt';
import {
  RESEARCH_PROMPT_VERSION,
  validateResearch,
  type ResearchAssistRequest,
} from './research-assistant';
import { MAX_VISION_BYTES, verifyVision, type VisionOutput } from './vision';

/**
 * Reading scans and suggesting research — everything decided here, without
 * a network: the request sent to the model, the checks applied to what comes
 * back, and the test double's honesty about what it can read.
 */

const ACT =
  'Est né le 12 juin 1851 à Tours, fils de Jean-Baptiste Chassagne, tonnelier, et de Rosalie Moreau.';

const provenance = { provider: 'test', model: 'm', promptVersion: 'p', pipelineVersion: 'v' };

describe('verifyVision', () => {
  const output: VisionOutput = {
    legibility: 'PARTIAL',
    transcription: `${ACT}\r\nTémoins : [illisible]`,
    documentKind: 'BIRTH_ACT',
    facts: [
      {
        predicate: 'BIRTH_DATE',
        subjectName: 'Gustave',
        valueText: '12 juin 1851',
        normalised: '12 JUN 1851',
        evidence: 'né le 12 juin 1851',
        confidence: 0.9,
      },
      {
        // Not in the reader's own transcription: invented, and discarded.
        predicate: 'DEATH_DATE',
        subjectName: 'Gustave',
        valueText: '3 août 1923',
        normalised: null,
        evidence: 'décédé le 3 août 1923',
        confidence: 0.4,
      },
    ],
    caveats: ['Un témoin illisible.'],
  };

  it('checks each statement against the reader’s own transcription', () => {
    const result = verifyVision(output, provenance);
    expect(result.legibility).toBe('PARTIAL');
    expect(result.transcription).toContain('\nTémoins');
    expect(result.extraction.facts.map((fact) => fact.predicate)).toEqual(['BIRTH_DATE']);
    expect(result.extraction.discarded).toBe(1);
  });

  it('treats statements with no transcription as no reading at all', () => {
    const result = verifyVision({ ...output, transcription: '   ' }, provenance);
    expect(result.legibility).toBe('POOR');
    expect(result.extraction.facts).toEqual([]);
    expect(result.extraction.discarded).toBe(2);
  });
});

// --- The test double ---------------------------------------------------------

function pngWithText(keyword: string, text: string): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let value = 0xffffffff;
    for (const byte of bytes) value = (crcTable[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  const itxt = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0, 0, 0, 0, 0]),
    Buffer.from(text, 'utf8'),
  ]);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('iTXt', itxt),
      chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0]))),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

describe('the test double reads text the file carries, never pixels', () => {
  it('finds a PNG’s transcription chunk, accents included', () => {
    expect(pngText(pngWithText('Transcription', ACT), 'Transcription')).toBe(ACT);
    expect(pngText(pngWithText('Other', ACT), 'Transcription')).toBe('');
  });

  it('finds the strings a PDF shows', () => {
    const pdf = new TextEncoder().encode('BT (Acte de naissance) Tj ET BT (folio \\(12\\)) Tj ET');
    expect(pdfText(pdf)).toBe('Acte de naissance\nfolio (12)');
  });

  it('reads an act embedded in a PNG through the same rules as a transcription', async () => {
    const result = await new FakeAIProvider().readScan({
      bytes: pngWithText('Transcription', ACT),
      mediaType: 'image/png',
      subjectHint: 'Gustave CHASSAGNE',
    });
    expect(result.legibility).toBe('GOOD');
    expect(result.transcription).toBe(ACT);
    expect(result.extraction.facts.some((fact) => fact.predicate === 'BIRTH_DATE')).toBe(true);
    expect(result.extraction.provenance.provider).toBe('fake');
  });

  it('says plainly that a real scan is beyond it', async () => {
    const result = await new FakeAIProvider().readScan({
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
      mediaType: 'image/jpeg',
    });
    expect(result.legibility).toBe('POOR');
    expect(result.extraction.caveats.join(' ')).toContain('ne lit pas les images');
  });

  it('refuses an image too large to send', async () => {
    await expect(
      new FakeAIProvider().readScan({
        bytes: new Uint8Array(MAX_VISION_BYTES + 1),
        mediaType: 'image/jpeg',
      }),
    ).rejects.toBeInstanceOf(ExtractionError);
  });
});

// --- The real provider, with the network replaced ----------------------------

function stub(parsed: unknown, extra: Record<string, unknown> = {}) {
  const parse = vi.fn(async () => ({
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    stop_details: null,
    parsed_output: parsed,
    ...extra,
  }));
  return { client: { beta: { messages: { parse } } } as unknown as ExtractionClient, parse };
}

const claude = (client: ExtractionClient) =>
  new AnthropicProvider({ apiKey: 'unused', model: 'claude-opus-5-5', timeoutMs: 1000, client });

describe('Claude reading a scan', () => {
  const parsed: VisionOutput = {
    legibility: 'GOOD',
    transcription: ACT,
    documentKind: 'BIRTH_ACT',
    facts: [],
    caveats: [],
  };

  it('sends an image block before the instruction, with the scan prompt and the refusal fallback', async () => {
    const { client, parse } = stub(parsed);
    await claude(client).readScan({ bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/jpeg' });
    const [body] = parse.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(body['system']).toBe(SCAN_SYSTEM_PROMPT);
    expect(body['fallbacks']).toBe('default');
    expect(body['betas']).toEqual(['server-side-fallback-2026-07-01']);
    const [message] = body['messages'] as Array<{ content: Array<Record<string, unknown>> }>;
    expect(message?.content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'AQID' },
    });
    expect(message?.content[1]).toMatchObject({ type: 'text' });
  });

  it('sends a PDF as a document block, unrasterised', async () => {
    const { client, parse } = stub(parsed);
    await claude(client).readScan({ bytes: new Uint8Array([1]), mediaType: 'application/pdf' });
    const [body] = parse.mock.calls[0] as unknown as [Record<string, unknown>];
    const [message] = body['messages'] as Array<{ content: Array<Record<string, unknown>> }>;
    expect(message?.content[0]).toMatchObject({
      type: 'document',
      source: { media_type: 'application/pdf' },
    });
  });

  it('turns a refusal and a truncated answer into errors, not readings', async () => {
    await expect(
      claude(
        stub(null, { stop_reason: 'refusal', stop_details: { category: 'cyber' } }).client,
      ).readScan({ bytes: new Uint8Array([1]), mediaType: 'image/png' }),
    ).rejects.toMatchObject({ code: 'REFUSED' });
    await expect(
      claude(stub(parsed, { stop_reason: 'max_tokens' }).client).readScan({
        bytes: new Uint8Array([1]),
        mediaType: 'image/png',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
  });
});

// --- The research assistant's checks -----------------------------------------

describe('validateResearch', () => {
  const request: ResearchAssistRequest = {
    person: 'Gustave CHASSAGNE',
    facts: [
      { id: 'f1', text: 'Naissance : 12 juin 1851, Tours (sourcée)' },
      { id: 'f2', text: 'Migration : avril 1889, Le Havre → Buenos Aires' },
    ],
    known: [{ id: 'g1', text: 'Décès sans source' }],
    limit: 5,
  };
  const keep = { provider: 'test', model: 'm', version: RESEARCH_PROMPT_VERSION };

  it('keeps grounded leads and drops those resting on nothing', () => {
    const result = validateResearch(
      {
        suggestions: [
          {
            question: 'Gustave CHASSAGNE a-t-il été naturalisé argentin ?',
            rationale: 'Il émigre en 1889.',
            whereToLook: 'Archives de Buenos Aires',
            basis: ['f2'],
          },
          { question: 'Une piste sans appui', rationale: '', whereToLook: null, basis: ['zz'] },
        ],
        caveats: [],
      },
      request,
      keep,
    );
    expect(result.suggestions.map((s) => s.basis)).toEqual([['f2']]);
    expect(result.dropped.noBasis).toBe(1);
  });

  it('drops a lead that names someone the record does not', () => {
    const result = validateResearch(
      {
        suggestions: [
          {
            question: 'Était-il le fils de Louis DURAND ?',
            rationale: 'Un DURAND habitait Tours.',
            whereToLook: 'BMS de Tours',
            basis: ['f1'],
          },
        ],
        caveats: [],
      },
      request,
      keep,
    );
    expect(result.suggestions).toEqual([]);
    expect(result.dropped.inventedName).toBe(1);
  });

  it('does not take archival abbreviations or Roman numerals for names', () => {
    const result = validateResearch(
      {
        suggestions: [
          {
            question: 'Retrouver le décès de CHASSAGNE au XXe siècle ?',
            rationale: 'Voir les tables décennales et l’état civil (NMD).',
            whereToLook: 'AD 37, registres BMS',
            basis: ['g1'],
          },
        ],
        caveats: [],
      },
      request,
      keep,
    );
    expect(result.suggestions).toHaveLength(1);
  });

  it('never returns more than asked', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      question: `Question ${i} ?`,
      rationale: '',
      whereToLook: null,
      basis: ['f1'],
    }));
    const result = validateResearch(
      { suggestions: many, caveats: [] },
      { ...request, limit: 3 },
      keep,
    );
    expect(result.suggestions).toHaveLength(3);
  });
});
