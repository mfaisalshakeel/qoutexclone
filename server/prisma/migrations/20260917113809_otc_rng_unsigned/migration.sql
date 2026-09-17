/*
  Warnings:

  - You are about to alter the column `rng` on the `OtcMarketState` table. The data in that column could be lost. The data in that column will be cast from `Int` to `UnsignedInt`.

*/
-- AlterTable
ALTER TABLE `Asset` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- AlterTable
ALTER TABLE `OtcMarketState` MODIFY `rng` INTEGER UNSIGNED NOT NULL;
