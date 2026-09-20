-- Profile preferences. Amounts stay in USD cents everywhere; `numberFormat`
-- only changes how they are written out.

-- AlterTable
ALTER TABLE `User`
  ADD COLUMN `avatar` VARCHAR(191) NULL,
  ADD COLUMN `timezone` VARCHAR(191) NULL,
  ADD COLUMN `language` VARCHAR(191) NULL,
  ADD COLUMN `numberFormat` VARCHAR(191) NULL,
  ADD COLUMN `notifyPrefs` JSON NULL;
