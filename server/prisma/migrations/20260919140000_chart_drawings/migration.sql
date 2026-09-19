-- The marks a trader has drawn, keyed by market symbol. Stored as given and
-- validated by the terminal that reads them, like the layout and the studies.

-- AlterTable
ALTER TABLE `User` ADD COLUMN `chartDrawings` JSON NULL;
