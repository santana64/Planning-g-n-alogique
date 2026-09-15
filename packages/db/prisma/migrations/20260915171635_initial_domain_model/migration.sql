-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'AUDIO', 'VIDEO');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('BIRTH_ACT', 'MARRIAGE_ACT', 'DEATH_ACT', 'BAPTISM_ACT', 'BURIAL_ACT', 'CENSUS_PAGE', 'MILITARY_RECORD', 'NOTARIAL_ACT', 'LETTER', 'CERTIFICATE', 'NEWSPAPER_CLIPPING', 'OTHER');

-- CreateEnum
CREATE TYPE "AiProposalStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EDITED_AND_ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TreeRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'CONTRIBUTOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "TreeVisibility" AS ENUM ('PRIVATE', 'LINK', 'PUBLIC');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('BIRTH', 'BAPTISM', 'DEATH', 'BURIAL', 'CREMATION', 'MARRIAGE', 'MARRIAGE_BANN', 'MARRIAGE_CONTRACT', 'CIVIL_UNION', 'DIVORCE', 'RESIDENCE', 'OCCUPATION', 'EDUCATION', 'MILITARY_SERVICE', 'MIGRATION', 'NATURALIZATION', 'CENSUS', 'PROBATE', 'WILL', 'RELIGIOUS_EVENT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('PRINCIPAL', 'SPOUSE', 'PARENT', 'CHILD', 'WITNESS', 'GODPARENT', 'OFFICIANT', 'INFORMANT', 'OTHER');

-- CreateEnum
CREATE TYPE "DateQualifier" AS ENUM ('EXACT', 'ABOUT', 'CALCULATED', 'ESTIMATED', 'BEFORE', 'AFTER', 'BETWEEN', 'RANGE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DateCalendar" AS ENUM ('GREGORIAN', 'JULIAN', 'FRENCH_R', 'HEBREW');

-- CreateEnum
CREATE TYPE "DatePrecision" AS ENUM ('DAY', 'MONTH', 'YEAR', 'DECADE', 'CENTURY', 'NONE');

-- CreateEnum
CREATE TYPE "PlaceType" AS ENUM ('COUNTRY', 'REGION', 'DEPARTMENT', 'COUNTY', 'CITY', 'TOWN', 'VILLAGE', 'HAMLET', 'PARISH', 'CEMETERY', 'BUILDING', 'ADDRESS', 'OTHER');

-- CreateEnum
CREATE TYPE "HistoricalEventCategory" AS ENUM ('WAR', 'POLITICAL', 'EPIDEMIC', 'DISASTER', 'MIGRATION', 'ECONOMIC', 'CULTURAL', 'RELIGIOUS', 'LEGAL', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('CIVIL_REGISTER', 'PARISH_REGISTER', 'CENSUS', 'MILITARY_RECORD', 'NOTARIAL_ACT', 'NEWSPAPER', 'CEMETERY', 'BOOK', 'WEBSITE', 'DATABASE', 'PHOTOGRAPH', 'LETTER', 'ORAL_HISTORY', 'DNA', 'OTHER');

-- CreateEnum
CREATE TYPE "ClaimPredicate" AS ENUM ('NAME', 'RECORDED_SEX', 'BIRTH_DATE', 'BIRTH_PLACE', 'DEATH_DATE', 'DEATH_PLACE', 'BAPTISM_DATE', 'BURIAL_DATE', 'MARRIAGE_DATE', 'MARRIAGE_PLACE', 'OCCUPATION', 'RESIDENCE', 'PARENT', 'SPOUSE', 'CHILD', 'MIGRATION', 'MILITARY_SERVICE', 'EDUCATION', 'RELIGION', 'NOTE', 'OTHER');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'DISPUTED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RecordedSex" AS ENUM ('MALE', 'FEMALE', 'INTERSEX', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "LivingStatus" AS ENUM ('LIVING', 'DECEASED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PrivacyLevel" AS ENUM ('INHERIT', 'VISIBLE', 'REDACTED', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH');

-- CreateEnum
CREATE TYPE "NameType" AS ENUM ('BIRTH', 'MARRIED', 'RELIGIOUS', 'IMMIGRANT', 'AKA', 'NICKNAME', 'PROFESSIONAL', 'OTHER');

-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('PARENT_BIOLOGICAL', 'PARENT_ADOPTIVE', 'PARENT_FOSTER', 'PARENT_STEP', 'PARENT_GUARDIAN', 'PARENT_UNKNOWN', 'SPOUSE', 'PARTNER', 'DIVORCED_PARTNER', 'SIBLING', 'OTHER');

-- CreateEnum
CREATE TYPE "DuplicateStatus" AS ENUM ('OPEN', 'MERGED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ResearchTaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'BLOCKED', 'RESOLVED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "ResearchPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "RevisionAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'MERGE', 'IMPORT', 'ACCEPT_CLAIM', 'REJECT_CLAIM');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('GEDCOM');

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "treeId" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbnailStorageKey" TEXT,
    "previewStorageKey" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "durationSeconds" DOUBLE PRECISION,
    "title" TEXT,
    "description" TEXT,
    "capturedEarliestJdn" INTEGER,
    "capturedLatestJdn" INTEGER,
    "capturedOriginalText" TEXT,
    "copyright" TEXT,
    "privacy" "PrivacyLevel" NOT NULL DEFAULT 'INHERIT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_media" (
    "eventId" UUID NOT NULL,
    "mediaId" UUID NOT NULL,

    CONSTRAINT "event_media_pkey" PRIMARY KEY ("eventId","mediaId")
);

-- CreateTable
CREATE TABLE "person_media_tags" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "mediaId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "confidence" "Confidence" NOT NULL DEFAULT 'MEDIUM',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "person_media_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "treeId" UUID NOT NULL,
    "kind" "DocumentKind" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL DEFAULT 1,
    "sourceId" UUID,
    "transcription" TEXT,
    "privacy" "PrivacyLevel" NOT NULL DEFAULT 'INHERIT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_pages" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "documentId" UUID NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "imageStorageKey" TEXT,
    "thumbnailStorageKey" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "transcription" TEXT,

    CONSTRAINT "document_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_proposals" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "treeId" UUID NOT NULL,
    "documentId" UUID,
    "documentPageId" UUID,
    "personId" UUID,
    "predicate" "ClaimPredicate" NOT NULL,
    "value" JSONB NOT NULL,
    "valueText" TEXT NOT NULL DEFAULT '',
    "modelConfidence" DOUBLE PRECISION,
    "evidenceSnippet" TEXT,
    "regionX" DOUBLE PRECISION,
    "regionY" DOUBLE PRECISION,
    "regionWidth" DOUBLE PRECISION,
    "regionHeight" DOUBLE PRECISION,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "pipelineVersion" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "AiProposalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" CITEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "displayLocale" TEXT NOT NULL DEFAULT 'fr',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "token" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "userId" UUID NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "idToken" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trees" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "TreeVisibility" NOT NULL DEFAULT 'PRIVATE',
    "redactLivingPeople" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "trees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tree_members" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "treeId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "TreeRole" NOT NULL DEFAULT 'VIEWER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tree_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tree_invitations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "treeId" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "role" "TreeRole" NOT NULL DEFAULT 'VIEWER',
    "tokenHash" TEXT NOT NULL,
    "invitedById" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tree_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "treeId" UUID NOT NULL,
    "type" "EventType" NOT NULL,
    "customType" TEXT,
    "dateQualifier" "DateQualifier" NOT NULL DEFAULT 'UNKNOWN',
    "dateCalendar" "DateCalendar" NOT NULL DEFAULT 'GREGORIAN',
    "datePrecision" "DatePrecision" NOT NULL DEFAULT 'NONE',
    "dateStartYear" INTEGER,
    "dateStartMonth" INTEGER,
    "dateStartDay" INTEGER,
    "dateEndYear" INTEGER,
    "dateEndMonth" INTEGER,
    "dateEndDay" INTEGER,
    "dateOriginalText" TEXT NOT NULL DEFAULT '',
    "dateUnparsed" BOOLEAN NOT NULL DEFAULT false,
    "dateEarliestJdn" INTEGER,
    "dateLatestJdn" INTEGER,
    "dateSortJdn" INTEGER,
    "placeId" UUID,
    "placeOriginalText" TEXT,
    "description" TEXT,
    "notes" TEXT,
    "confidence" "Confidence" NOT NULL DEFAULT 'MEDIUM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_participants" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "eventId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "role" "ParticipantRole" NOT NULL DEFAULT 'PRINCIPAL',
    "roleLabel" TEXT,

    CONSTRAINT "event_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "places" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "treeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalisedName" TEXT NOT NULL DEFAULT '',
    "type" "PlaceType" NOT NULL DEFAULT 'OTHER',
    "parentId" UUID,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "geom" geography(Point, 4326),
    "countryCode" CHAR(2),
    "historicalName" TEXT,
    "validFromJdn" INTEGER,
    "validToJdn" INTEGER,
    "externalIds" JSONB,
    "confidence" "Confidence" NOT NULL DEFAULT 'MEDIUM',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historical_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "category" "HistoricalEventCategory" NOT NULL,
    "significance" INTEGER NOT NULL DEFAULT 3,
    "startJdn" INTEGER NOT NULL,
    "endJdn" INTEGER NOT NULL,
    "countryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "regionLabels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minLatitude" DOUBLE PRECISION,
    "maxLatitude" DOUBLE PRECISION,
    "minLongitude" DOUBLE PRECISION,
    "maxLongitude" DOUBLE PRECISION,
    "references" JSONB,
    "locale" TEXT NOT NULL DEFAULT 'fr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "historical_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tree_historical_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "treeId" UUID NOT NULL,
    "historicalEventId" UUID NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,

    CONSTRAINT "tree_historical_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "treeId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "type" "SourceType" NOT NULL DEFAULT 'OTHER',
    "author" TEXT,
    "publisher" TEXT,
    "publishedAt" TEXT,
    "repository" TEXT,
    "callNumber" TEXT,
    "url" TEXT,
    "accessedAt" TIMESTAMP(3),
    "notes" TEXT,
    "reliability" "Confidence" NOT NULL DEFAULT 'MEDIUM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "treeId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "locator" TEXT,
    "page" TEXT,
    "volume" TEXT,
    "quotation" TEXT,
    "confidence" "Confidence" NOT NULL DEFAULT 'MEDIUM',
    "notes" TEXT,
    "documentId" UUID,
    "documentPageId" UUID,
    "eventId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claims" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "treeId" UUID NOT NULL,
    "personId" UUID,
    "relationshipId" UUID,
    "eventId" UUID,
    "predicate" "ClaimPredicate" NOT NULL,
    "value" JSONB NOT NULL,
    "valueText" TEXT NOT NULL DEFAULT '',
    "status" "ClaimStatus" NOT NULL DEFAULT 'PROPOSED',
    "confidence" "Confidence" NOT NULL DEFAULT 'MEDIUM',
    "supersededById" UUID,
    "aiProposalId" UUID,
    "createdById" UUID,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_citations" (
    "claimId" UUID NOT NULL,
    "citationId" UUID NOT NULL,

    CONSTRAINT "claim_citations_pkey" PRIMARY KEY ("claimId","citationId")
);

-- CreateTable
CREATE TABLE "people" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "treeId" UUID NOT NULL,
    "recordedSex" "RecordedSex" NOT NULL DEFAULT 'UNKNOWN',
    "livingStatus" "LivingStatus" NOT NULL DEFAULT 'UNKNOWN',
    "privacy" "PrivacyLevel" NOT NULL DEFAULT 'INHERIT',
    "displayName" TEXT NOT NULL DEFAULT '',
    "searchName" TEXT NOT NULL DEFAULT '',
    "lifespanEarliestJdn" INTEGER,
    "lifespanLatestJdn" INTEGER,
    "lifespanLatestInferred" BOOLEAN NOT NULL DEFAULT false,
    "birthSortJdn" INTEGER,
    "generationDepth" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_names" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "treeId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "type" "NameType" NOT NULL DEFAULT 'BIRTH',
    "prefix" TEXT,
    "given" TEXT,
    "nickname" TEXT,
    "surname" TEXT,
    "surnamePrefix" TEXT,
    "suffix" TEXT,
    "birthSurname" TEXT,
    "displayForm" TEXT,
    "normalisedSurname" TEXT NOT NULL DEFAULT '',
    "normalisedGiven" TEXT NOT NULL DEFAULT '',
    "validFromJdn" INTEGER,
    "validToJdn" INTEGER,
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,
    "confidence" "Confidence" NOT NULL DEFAULT 'MEDIUM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_names_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relationships" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "treeId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "targetId" UUID NOT NULL,
    "type" "RelationshipType" NOT NULL,
    "startJdn" INTEGER,
    "endJdn" INTEGER,
    "confidence" "Confidence" NOT NULL DEFAULT 'MEDIUM',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,

    CONSTRAINT "relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duplicate_candidates" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "treeId" UUID NOT NULL,
    "leftId" UUID NOT NULL,
    "rightId" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "scorerVersion" TEXT NOT NULL,
    "explanation" JSONB NOT NULL,
    "status" "DuplicateStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duplicate_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_tasks" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "treeId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "hypothesis" TEXT,
    "personId" UUID,
    "status" "ResearchTaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "ResearchPriority" NOT NULL DEFAULT 'NORMAL',
    "repository" TEXT,
    "collection" TEXT,
    "callNumber" TEXT,
    "url" TEXT,
    "searchFromJdn" INTEGER,
    "searchToJdn" INTEGER,
    "placeLabel" TEXT,
    "notes" TEXT,
    "outcome" TEXT,
    "assignedToId" UUID,
    "dueAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,

    CONSTRAINT "research_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revisions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "treeId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "action" "RevisionAction" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "summary" TEXT,
    "actorId" UUID,
    "batchId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "treeId" UUID NOT NULL,
    "kind" "ImportKind" NOT NULL DEFAULT 'GEDCOM',
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "originalFilename" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "detectedEncoding" TEXT,
    "detectedVersion" TEXT,
    "isDryRun" BOOLEAN NOT NULL DEFAULT true,
    "peopleCount" INTEGER NOT NULL DEFAULT 0,
    "familyCount" INTEGER NOT NULL DEFAULT 0,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "sourceCount" INTEGER NOT NULL DEFAULT 0,
    "mediaCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCandidateCount" INTEGER NOT NULL DEFAULT 0,
    "processedRecords" INTEGER NOT NULL DEFAULT 0,
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "warnings" JSONB,
    "unknownTags" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_storageKey_key" ON "media"("storageKey");

-- CreateIndex
CREATE INDEX "media_treeId_kind_idx" ON "media"("treeId", "kind");

-- CreateIndex
CREATE INDEX "media_treeId_checksum_idx" ON "media"("treeId", "checksum");

-- CreateIndex
CREATE INDEX "event_media_mediaId_idx" ON "event_media"("mediaId");

-- CreateIndex
CREATE INDEX "person_media_tags_personId_idx" ON "person_media_tags"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "person_media_tags_mediaId_personId_key" ON "person_media_tags"("mediaId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "documents_storageKey_key" ON "documents"("storageKey");

-- CreateIndex
CREATE INDEX "documents_treeId_kind_idx" ON "documents"("treeId", "kind");

-- CreateIndex
CREATE INDEX "documents_sourceId_idx" ON "documents"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "document_pages_documentId_pageNumber_key" ON "document_pages"("documentId", "pageNumber");

-- CreateIndex
CREATE INDEX "ai_proposals_treeId_status_idx" ON "ai_proposals"("treeId", "status");

-- CreateIndex
CREATE INDEX "ai_proposals_documentId_idx" ON "ai_proposals"("documentId");

-- CreateIndex
CREATE INDEX "ai_proposals_personId_idx" ON "ai_proposals"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_providerId_accountId_key" ON "accounts"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");

-- CreateIndex
CREATE INDEX "verifications_expiresAt_idx" ON "verifications"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "trees_slug_key" ON "trees"("slug");

-- CreateIndex
CREATE INDEX "trees_deletedAt_idx" ON "trees"("deletedAt");

-- CreateIndex
CREATE INDEX "tree_members_userId_idx" ON "tree_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "tree_members_treeId_userId_key" ON "tree_members"("treeId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "tree_invitations_tokenHash_key" ON "tree_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "tree_invitations_treeId_email_idx" ON "tree_invitations"("treeId", "email");

-- CreateIndex
CREATE INDEX "tree_invitations_expiresAt_idx" ON "tree_invitations"("expiresAt");

-- CreateIndex
CREATE INDEX "events_treeId_type_idx" ON "events"("treeId", "type");

-- CreateIndex
CREATE INDEX "events_treeId_dateSortJdn_idx" ON "events"("treeId", "dateSortJdn");

-- CreateIndex
CREATE INDEX "events_treeId_dateEarliestJdn_dateLatestJdn_idx" ON "events"("treeId", "dateEarliestJdn", "dateLatestJdn");

-- CreateIndex
CREATE INDEX "events_placeId_idx" ON "events"("placeId");

-- CreateIndex
CREATE INDEX "event_participants_personId_idx" ON "event_participants"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "event_participants_eventId_personId_role_key" ON "event_participants"("eventId", "personId", "role");

-- CreateIndex
CREATE INDEX "places_treeId_normalisedName_idx" ON "places"("treeId", "normalisedName");

-- CreateIndex
CREATE INDEX "places_treeId_type_idx" ON "places"("treeId", "type");

-- CreateIndex
CREATE INDEX "places_parentId_idx" ON "places"("parentId");

-- CreateIndex
CREATE INDEX "historical_events_startJdn_endJdn_idx" ON "historical_events"("startJdn", "endJdn");

-- CreateIndex
CREATE INDEX "historical_events_category_significance_idx" ON "historical_events"("category", "significance");

-- CreateIndex
CREATE UNIQUE INDEX "tree_historical_events_treeId_historicalEventId_key" ON "tree_historical_events"("treeId", "historicalEventId");

-- CreateIndex
CREATE INDEX "sources_treeId_type_idx" ON "sources"("treeId", "type");

-- CreateIndex
CREATE INDEX "sources_treeId_title_idx" ON "sources"("treeId", "title");

-- CreateIndex
CREATE INDEX "citations_treeId_sourceId_idx" ON "citations"("treeId", "sourceId");

-- CreateIndex
CREATE INDEX "citations_documentId_idx" ON "citations"("documentId");

-- CreateIndex
CREATE INDEX "claims_treeId_personId_predicate_status_idx" ON "claims"("treeId", "personId", "predicate", "status");

-- CreateIndex
CREATE INDEX "claims_treeId_status_idx" ON "claims"("treeId", "status");

-- CreateIndex
CREATE INDEX "claims_relationshipId_idx" ON "claims"("relationshipId");

-- CreateIndex
CREATE INDEX "claims_eventId_idx" ON "claims"("eventId");

-- CreateIndex
CREATE INDEX "claims_aiProposalId_idx" ON "claims"("aiProposalId");

-- CreateIndex
CREATE INDEX "claim_citations_citationId_idx" ON "claim_citations"("citationId");

-- CreateIndex
CREATE INDEX "people_treeId_deletedAt_idx" ON "people"("treeId", "deletedAt");

-- CreateIndex
CREATE INDEX "people_treeId_searchName_idx" ON "people"("treeId", "searchName");

-- CreateIndex
CREATE INDEX "people_treeId_birthSortJdn_idx" ON "people"("treeId", "birthSortJdn");

-- CreateIndex
CREATE INDEX "people_treeId_lifespanEarliestJdn_lifespanLatestJdn_idx" ON "people"("treeId", "lifespanEarliestJdn", "lifespanLatestJdn");

-- CreateIndex
CREATE INDEX "people_treeId_livingStatus_idx" ON "people"("treeId", "livingStatus");

-- CreateIndex
CREATE INDEX "person_names_personId_idx" ON "person_names"("personId");

-- CreateIndex
CREATE INDEX "person_names_treeId_normalisedSurname_idx" ON "person_names"("treeId", "normalisedSurname");

-- CreateIndex
CREATE INDEX "person_names_treeId_normalisedGiven_idx" ON "person_names"("treeId", "normalisedGiven");

-- CreateIndex
CREATE INDEX "relationships_treeId_sourceId_idx" ON "relationships"("treeId", "sourceId");

-- CreateIndex
CREATE INDEX "relationships_treeId_targetId_idx" ON "relationships"("treeId", "targetId");

-- CreateIndex
CREATE INDEX "relationships_treeId_type_idx" ON "relationships"("treeId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "relationships_sourceId_targetId_type_key" ON "relationships"("sourceId", "targetId", "type");

-- CreateIndex
CREATE INDEX "duplicate_candidates_treeId_status_score_idx" ON "duplicate_candidates"("treeId", "status", "score");

-- CreateIndex
CREATE UNIQUE INDEX "duplicate_candidates_leftId_rightId_key" ON "duplicate_candidates"("leftId", "rightId");

-- CreateIndex
CREATE INDEX "research_tasks_treeId_status_priority_idx" ON "research_tasks"("treeId", "status", "priority");

-- CreateIndex
CREATE INDEX "research_tasks_personId_idx" ON "research_tasks"("personId");

-- CreateIndex
CREATE INDEX "research_tasks_assignedToId_idx" ON "research_tasks"("assignedToId");

-- CreateIndex
CREATE INDEX "revisions_treeId_createdAt_idx" ON "revisions"("treeId", "createdAt");

-- CreateIndex
CREATE INDEX "revisions_entityType_entityId_idx" ON "revisions"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "revisions_batchId_idx" ON "revisions"("batchId");

-- CreateIndex
CREATE INDEX "import_jobs_treeId_status_idx" ON "import_jobs"("treeId", "status");

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_media" ADD CONSTRAINT "event_media_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_media" ADD CONSTRAINT "event_media_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_media_tags" ADD CONSTRAINT "person_media_tags_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_media_tags" ADD CONSTRAINT "person_media_tags_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_documentPageId_fkey" FOREIGN KEY ("documentPageId") REFERENCES "document_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tree_members" ADD CONSTRAINT "tree_members_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tree_members" ADD CONSTRAINT "tree_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tree_invitations" ADD CONSTRAINT "tree_invitations_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tree_invitations" ADD CONSTRAINT "tree_invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "places" ADD CONSTRAINT "places_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "places" ADD CONSTRAINT "places_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tree_historical_events" ADD CONSTRAINT "tree_historical_events_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tree_historical_events" ADD CONSTRAINT "tree_historical_events_historicalEventId_fkey" FOREIGN KEY ("historicalEventId") REFERENCES "historical_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_documentPageId_fkey" FOREIGN KEY ("documentPageId") REFERENCES "document_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "relationships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_aiProposalId_fkey" FOREIGN KEY ("aiProposalId") REFERENCES "ai_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_citations" ADD CONSTRAINT "claim_citations_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_citations" ADD CONSTRAINT "claim_citations_citationId_fkey" FOREIGN KEY ("citationId") REFERENCES "citations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_names" ADD CONSTRAINT "person_names_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_leftId_fkey" FOREIGN KEY ("leftId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_rightId_fkey" FOREIGN KEY ("rightId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_tasks" ADD CONSTRAINT "research_tasks_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_tasks" ADD CONSTRAINT "research_tasks_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_tasks" ADD CONSTRAINT "research_tasks_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- Hand-written additions
--
-- Everything below expresses a rule Prisma's schema language cannot state.
-- It is part of the migration rather than a setup script so that a production
-- database created by `prisma migrate deploy` is complete on its own.
-- ===========================================================================

-- --- Accent-insensitive search ---------------------------------------------
-- The stock unaccent() is STABLE, not IMMUTABLE, so PostgreSQL refuses it in
-- an expression index. Genealogical name search is worthless without indexed
-- accent-insensitive lookup ("Lefevre" must find "Lefèvre"), hence a wrapper
-- that pins the dictionary and can therefore be declared IMMUTABLE.
CREATE OR REPLACE FUNCTION chronolignee_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;

-- --- Fuzzy matching indexes ------------------------------------------------
-- Trigram indexes drive both the command palette and the duplicate scorer.
-- Without them a surname search over 20 000 people is a sequential scan.
CREATE INDEX "people_search_name_trgm"
  ON "people" USING gin ("searchName" gin_trgm_ops);

CREATE INDEX "person_names_surname_trgm"
  ON "person_names" USING gin ("normalisedSurname" gin_trgm_ops);

CREATE INDEX "person_names_given_trgm"
  ON "person_names" USING gin ("normalisedGiven" gin_trgm_ops);

CREATE INDEX "places_name_trgm"
  ON "places" USING gin ("normalisedName" gin_trgm_ops);

CREATE INDEX "sources_title_trgm"
  ON "sources" USING gin (chronolignee_unaccent(lower("title")) gin_trgm_ops);

-- --- Spatial ---------------------------------------------------------------
-- Prisma cannot index an Unsupported column. "Which branches passed through
-- this region" is a spatial question and needs a spatial index.
CREATE INDEX "places_geom_gist" ON "places" USING gist ("geom");

-- --- Integrity: a claim has exactly one subject ----------------------------
-- The three subject columns are a typed polymorphic reference. Without this
-- constraint a claim could describe nothing, or two things at once.
ALTER TABLE "claims" ADD CONSTRAINT "claims_exactly_one_subject" CHECK (
  (("personId" IS NOT NULL)::int
 + ("relationshipId" IS NOT NULL)::int
 + ("eventId" IS NOT NULL)::int) = 1
);

-- --- Integrity: nobody is their own parent or spouse ------------------------
-- The cheapest half of the acyclicity guarantee. Longer cycles are caught by
-- the recursive check in @chronolignee/genealogy before a write is attempted;
-- this one is free and catches the overwhelmingly common case.
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_no_self_reference" CHECK (
  "sourceId" <> "targetId"
);

-- --- Integrity: temporal windows are ordered --------------------------------
-- A window whose end precedes its start is not uncertainty, it is corruption,
-- and it would make every interval comparison downstream meaningless.
ALTER TABLE "events" ADD CONSTRAINT "events_date_window_ordered" CHECK (
  "dateEarliestJdn" IS NULL OR "dateLatestJdn" IS NULL
  OR "dateEarliestJdn" <= "dateLatestJdn"
);

ALTER TABLE "people" ADD CONSTRAINT "people_lifespan_window_ordered" CHECK (
  "lifespanEarliestJdn" IS NULL OR "lifespanLatestJdn" IS NULL
  OR "lifespanEarliestJdn" <= "lifespanLatestJdn"
);

ALTER TABLE "relationships" ADD CONSTRAINT "relationships_window_ordered" CHECK (
  "startJdn" IS NULL OR "endJdn" IS NULL OR "startJdn" <= "endJdn"
);

ALTER TABLE "historical_events" ADD CONSTRAINT "historical_events_window_ordered" CHECK (
  "startJdn" <= "endJdn"
);

-- --- Integrity: a CUSTOM event must say what it is --------------------------
ALTER TABLE "events" ADD CONSTRAINT "events_custom_type_labelled" CHECK (
  "type" <> 'CUSTOM' OR ("customType" IS NOT NULL AND length(btrim("customType")) > 0)
);

-- --- Integrity: significance is a 1-5 scale ---------------------------------
ALTER TABLE "historical_events" ADD CONSTRAINT "historical_events_significance_range" CHECK (
  "significance" BETWEEN 1 AND 5
);

-- --- Integrity: media tag regions are normalised fractions ------------------
-- Regions are stored as 0-1 fractions so they survive the image being
-- re-rendered at a different size. Pixel values would silently break on the
-- first thumbnail regeneration.
ALTER TABLE "person_media_tags" ADD CONSTRAINT "person_media_tags_region_normalised" CHECK (
  ("x" IS NULL OR ("x" >= 0 AND "x" <= 1))
  AND ("y" IS NULL OR ("y" >= 0 AND "y" <= 1))
  AND ("width" IS NULL OR ("width" > 0 AND "width" <= 1))
  AND ("height" IS NULL OR ("height" > 0 AND "height" <= 1))
);

-- --- Integrity: model confidence is a probability ---------------------------
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_confidence_range" CHECK (
  "modelConfidence" IS NULL OR ("modelConfidence" >= 0 AND "modelConfidence" <= 1)
);

ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_score_range" CHECK (
  "score" >= 0 AND "score" <= 1
);

-- --- Integrity: a duplicate pair is unordered -------------------------------
-- Storing (A,B) and (B,A) would surface the same pair twice in review.
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_ordered_pair" CHECK (
  "leftId" < "rightId"
);

-- --- Integrity: coordinates are on Earth ------------------------------------
ALTER TABLE "places" ADD CONSTRAINT "places_coordinates_valid" CHECK (
  ("latitude" IS NULL OR ("latitude" >= -90 AND "latitude" <= 90))
  AND ("longitude" IS NULL OR ("longitude" >= -180 AND "longitude" <= 180))
);

-- --- Integrity: a place is not its own ancestor -----------------------------
ALTER TABLE "places" ADD CONSTRAINT "places_no_self_parent" CHECK (
  "parentId" IS NULL OR "parentId" <> "id"
);
