-- Adds market classification, display pairs, OTC variants and pip sizes.
--
-- Written by hand: Prisma's generated version added `pair` and `updatedAt` as
-- NOT NULL without defaults, which cannot apply to a table that already holds
-- markets. Columns land with safe defaults, existing rows are backfilled from
-- the data already present, then the placeholder default is dropped.

-- AlterTable
ALTER TABLE `Asset`
    ADD COLUMN `assetClass` VARCHAR(191) NOT NULL DEFAULT 'CRYPTO',
    ADD COLUMN `icon` VARCHAR(191) NULL,
    ADD COLUMN `isOtc` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `pair` VARCHAR(191) NOT NULL DEFAULT '',
    ADD COLUMN `pipSize` DOUBLE NOT NULL DEFAULT 0.01,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- Backfill: every market that existed before this migration is spot crypto
-- quoted in USD, so the display pair and pip size follow from its own columns.
UPDATE `Asset` SET `pair` = CONCAT(`base`, '/', `quote`) WHERE `pair` = '';
UPDATE `Asset` SET `pipSize` = POWER(10, -`precision`);
UPDATE `Asset` SET `icon` = `base` WHERE `icon` IS NULL;

-- The schema declares no default for `pair`; the one above was only for the backfill.
ALTER TABLE `Asset` ALTER COLUMN `pair` DROP DEFAULT;

-- CreateIndex
CREATE INDEX `Asset_assetClass_enabled_sortOrder_idx` ON `Asset`(`assetClass`, `enabled`, `sortOrder`);

-- CreateIndex
CREATE INDEX `Asset_isOtc_enabled_idx` ON `Asset`(`isOtc`, `enabled`);
