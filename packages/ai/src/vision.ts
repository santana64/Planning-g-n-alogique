import { z } from 'zod';
import {
  DOCUMENT_KINDS,
  FACT_PREDICATES,
  verifyExtraction,
  type ExtractionProvenance,
  type ExtractionResult,
} from './extraction';
import { ExtractionError } from './provider';

/**
 * Reading a scan: an image of a register page, or a PDF.
 *
 * The same rule as reading a typed transcription, one step further from the
 * source. The reader returns its own transcription of the scan and the
 * statements it finds; each statement's evidence must occur in that
 * transcription or it is discarded, exactly as before.
 *
 * What that check cannot do is prove the transcription matches the image —
 * only a person looking at both can. So the machine's transcription is never
 * written into the document's transcription. It is shown beside the scan as
 * a proposal, with how legible the reader found the page, and becomes the
 * transcription only when someone copies it there and saves.
 */

/** The image formats a reader is sent; anything else is converted first. */
export const VISION_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export type VisionImageType = (typeof VISION_IMAGE_TYPES)[number];

export interface VisionRequest {
  readonly bytes: Uint8Array;
  readonly mediaType: VisionImageType | 'application/pdf';
  /** As for text: whose record the reading was started from. */
  readonly subjectHint?: string | undefined;
}

/**
 * Four megabytes after encoding: a register page at a legible resolution is
 * well under, and the API's per-image limit is not a place to discover a
 * 30 MB TIFF. Larger images are reduced by the worker before they get here.
 */
export const MAX_VISION_BYTES = 4 * 1024 * 1024;
/** A PDF of a few acts, not a whole register. */
export const MAX_VISION_PDF_BYTES = 24 * 1024 * 1024;

export function assertReadable(request: VisionRequest): void {
  if (request.bytes.byteLength === 0) throw new ExtractionError('EMPTY');
  const limit = request.mediaType === 'application/pdf' ? MAX_VISION_PDF_BYTES : MAX_VISION_BYTES;
  if (request.bytes.byteLength > limit) {
    throw new ExtractionError('TOO_LONG', `${request.bytes.byteLength} bytes`);
  }
}

export const LEGIBILITY = ['GOOD', 'PARTIAL', 'POOR'] as const;
export type Legibility = (typeof LEGIBILITY)[number];

/** What a reader returns for a scan. No numeric bounds: checked in code. */
export const visionOutputSchema = z.object({
  legibility: z.enum(LEGIBILITY),
  /** The text as the reader reads it, line breaks kept, nothing modernised. */
  transcription: z.string(),
  documentKind: z.enum(DOCUMENT_KINDS),
  facts: z.array(
    z.object({
      predicate: z.enum(FACT_PREDICATES),
      subjectName: z.string(),
      valueText: z.string(),
      normalised: z.string().nullable(),
      /** Copied from the reader's own transcription above. */
      evidence: z.string(),
      confidence: z.number(),
    }),
  ),
  caveats: z.array(z.string()),
});
export type VisionOutput = z.infer<typeof visionOutputSchema>;

export interface VisionResult {
  readonly legibility: Legibility;
  readonly transcription: string;
  readonly extraction: ExtractionResult;
}

/** The longest machine transcription kept: a dense page, not a book. */
export const MAX_MACHINE_TRANSCRIPTION = 60_000;

/**
 * The reader's output, checked.
 *
 * An empty transcription with statements is a contradiction — the evidence
 * of every statement would have nowhere to be — so it is treated as no
 * reading at all. A transcription longer than any page is cut and said so.
 */
export function verifyVision(output: VisionOutput, provenance: ExtractionProvenance): VisionResult {
  let transcription = output.transcription.replace(/\r\n?/g, '\n').trim();
  const caveats = [...output.caveats];
  if (transcription.length > MAX_MACHINE_TRANSCRIPTION) {
    transcription = transcription.slice(0, MAX_MACHINE_TRANSCRIPTION);
    caveats.push('Transcription tronquée : le document dépasse la longueur d’une page.');
  }
  if (!transcription) {
    return {
      legibility: 'POOR',
      transcription: '',
      extraction: {
        documentKind: output.documentKind,
        facts: [],
        caveats: [...caveats, 'Aucun texte lu sur ce document.'],
        discarded: output.facts.length,
        provenance,
      },
    };
  }
  return {
    legibility: output.legibility,
    transcription,
    extraction: verifyExtraction({ ...output, caveats }, transcription, provenance),
  };
}
