-- The First World War is the context of its belligerents, not of every tree:
-- Argentina stayed neutral. Keeps the catalogue (src/history/catalogue.ts)
-- and the database in step.
UPDATE "historical_events"
SET "countryCodes" = ARRAY['FR', 'BE', 'GB', 'DE', 'AT', 'IT', 'RU', 'RS', 'US']::text[],
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "title" = 'Première Guerre mondiale';
