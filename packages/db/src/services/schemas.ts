import { z } from 'zod';

/**
 * What a write accepts.
 *
 * The exported types are `z.input`, not `z.infer`. Every service takes a
 * `raw` argument and parses it here, so the type a caller writes is the one
 * before defaults are filled in and before `''` becomes `null` — demanding the
 * parsed shape would make callers supply the very fields the schema exists to
 * supply for them.
 *
 * Separate from the domain types on purpose: the domain describes what a
 * person *is*, and these describe what an API is willing to be told. They
 * differ in the ways that matter at a boundary — a form sends empty strings
 * where the model wants null, a client can send a thousand-character name, and
 * an id arriving from outside is a string until it has been checked.
 *
 * Every field that reaches the database passes through here. A schema that
 * covers most of an input is a schema nobody can reason about.
 */

/**
 * Trimmed text, where cleared and absent are different things.
 *
 * Empty becomes `null`, not `undefined`. The distinction is the whole point:
 * `undefined` means the caller said nothing about this field and it must be
 * left alone, `null` means the user emptied it and wants it gone. Collapsing
 * both to `undefined` — which this did — made it impossible to remove a date
 * or a note at all: the form submitted an empty string, every update guard
 * read it as "not sent", and the save reported success while changing
 * nothing. Having to type a wrong date in order to delete a wrong date is
 * the opposite of a research tool.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .optional();

export const RECORDED_SEX = ['MALE', 'FEMALE', 'INTERSEX', 'UNKNOWN'] as const;
export const LIVING_STATUS = ['LIVING', 'DECEASED', 'UNKNOWN'] as const;
export const CONFIDENCE = ['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'] as const;
export const NAME_TYPE = [
  'BIRTH',
  'MARRIED',
  'RELIGIOUS',
  'IMMIGRANT',
  'AKA',
  'NICKNAME',
  'PROFESSIONAL',
  'OTHER',
] as const;

export const personNameInput = z.object({
  type: z.enum(NAME_TYPE).default('BIRTH'),
  prefix: optionalText(40),
  given: optionalText(120),
  surnamePrefix: optionalText(40),
  surname: optionalText(120),
  suffix: optionalText(40),
  nickname: optionalText(80),
  isPreferred: z.boolean().default(false),
  confidence: z.enum(CONFIDENCE).default('MEDIUM'),
});
export type PersonNameInput = z.input<typeof personNameInput>;
/**
 * A name after parsing: defaults filled in, cleared fields turned into null.
 * What the services work with once `.parse` has run, as opposed to what a
 * caller hands them.
 */
export type PersonNameValue = z.output<typeof personNameInput>;

/**
 * The person fields, with no defaults.
 *
 * Defaults belong to creation only. `.partial()` in Zod removes the
 * requirement but KEEPS the default, so a partial schema built from one that
 * defaults `livingStatus` to UNKNOWN silently sets it on every update — and
 * because privacy follows living status, editing a living person's surname
 * would have un-redacted them. Splitting the base from the defaults is what
 * makes "field absent" actually mean absent.
 */
const personFields = {
  recordedSex: z.enum(RECORDED_SEX),
  livingStatus: z.enum(LIVING_STATUS),
  names: z.array(personNameInput).min(1).max(12),
  notes: optionalText(10_000),

  /** Free text; parsed by the domain parser, kept verbatim if unreadable. */
  birthDate: optionalText(200),
  birthPlace: optionalText(300),
  deathDate: optionalText(200),
  deathPlace: optionalText(300),
};

export const createPersonInput = z.object({
  ...personFields,
  recordedSex: personFields.recordedSex.default('UNKNOWN'),
  livingStatus: personFields.livingStatus.default('UNKNOWN'),
  // At least one name, because a person with no name at all cannot be found
  // again and becomes an orphan row nobody knows how to fix.
  names: personFields.names,
});
export type CreatePersonInput = z.input<typeof createPersonInput>;

export const updatePersonInput = z.object(personFields).partial().extend({ personId: z.uuid() });
export type UpdatePersonInput = z.input<typeof updatePersonInput>;

export const RELATIONSHIP_TYPES = [
  'PARENT_BIOLOGICAL',
  'PARENT_ADOPTIVE',
  'PARENT_FOSTER',
  'PARENT_STEP',
  'PARENT_GUARDIAN',
  'PARENT_UNKNOWN',
  'SPOUSE',
  'PARTNER',
  'DIVORCED_PARTNER',
  'SIBLING',
  'OTHER',
] as const;

export const createRelationshipInput = z
  .object({
    /** For a parent type, the parent. The direction is fixed; see the schema. */
    sourceId: z.uuid(),
    targetId: z.uuid(),
    type: z.enum(RELATIONSHIP_TYPES),
    startDate: optionalText(200),
    endDate: optionalText(200),
    confidence: z.enum(CONFIDENCE).default('MEDIUM'),
    notes: optionalText(4000),
  })
  .refine((input) => input.sourceId !== input.targetId, {
    // Caught here as well as by the CHECK constraint and by the validator: the
    // cheapest rejection is the one closest to the form.
    message: 'Une personne ne peut pas être en relation avec elle-même.',
    path: ['targetId'],
  });
export type CreateRelationshipInput = z.input<typeof createRelationshipInput>;

export const EVENT_TYPES = [
  'BIRTH',
  'BAPTISM',
  'DEATH',
  'BURIAL',
  'CREMATION',
  'MARRIAGE',
  'MARRIAGE_BANN',
  'MARRIAGE_CONTRACT',
  'CIVIL_UNION',
  'DIVORCE',
  'RESIDENCE',
  'OCCUPATION',
  'EDUCATION',
  'MILITARY_SERVICE',
  'MIGRATION',
  'NATURALIZATION',
  'CENSUS',
  'PROBATE',
  'WILL',
  'RELIGIOUS_EVENT',
  'CUSTOM',
] as const;

export const PARTICIPANT_ROLES = [
  'PRINCIPAL',
  'SPOUSE',
  'PARENT',
  'CHILD',
  'WITNESS',
  'GODPARENT',
  'OFFICIANT',
  'INFORMANT',
  'OTHER',
] as const;

export const createEventInput = z
  .object({
    type: z.enum(EVENT_TYPES),
    customType: optionalText(120),
    date: optionalText(200),
    placeName: optionalText(300),
    description: optionalText(2000),
    notes: optionalText(4000),
    confidence: z.enum(CONFIDENCE).default('MEDIUM'),
    participants: z
      .array(
        z.object({
          personId: z.uuid(),
          role: z.enum(PARTICIPANT_ROLES).default('PRINCIPAL'),
        }),
      )
      .min(1)
      .max(50),
  })
  .refine((input) => input.type !== 'CUSTOM' || Boolean(input.customType), {
    // Mirrors the CHECK constraint. Rejecting here gives the user a field to
    // fix rather than a database error to decipher.
    message: 'Un événement personnalisé doit être nommé.',
    path: ['customType'],
  });
export type CreateEventInput = z.input<typeof createEventInput>;

export const updateEventInput = z.object({
  eventId: z.uuid(),
  date: optionalText(200),
  placeName: optionalText(300),
  description: optionalText(2000),
  notes: optionalText(4000),
  confidence: z.enum(CONFIDENCE).optional(),
});
export type UpdateEventInput = z.input<typeof updateEventInput>;
