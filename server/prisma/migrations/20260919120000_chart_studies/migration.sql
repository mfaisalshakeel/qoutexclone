-- The studies a trader has on their chart, with the periods and colours they
-- chose. Stored as given and validated by the reader, like the terminal layout:
-- a stale shape from an older version must never stop the chart rendering.

-- AlterTable
ALTER TABLE `User` ADD COLUMN `chartStudies` JSON NULL;
