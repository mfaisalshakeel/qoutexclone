-- Two expiry modes. `Asset.durations` narrows the platform list for one market
-- (null keeps the platform list), and `Trade.expiryMode` records how a position
-- was bought so history can show it. Existing positions were all bought by
-- duration, which is the column's default.

-- AlterTable
ALTER TABLE `Asset` ADD COLUMN `durations` JSON NULL;

-- AlterTable
ALTER TABLE `Trade` ADD COLUMN `expiryMode` VARCHAR(191) NOT NULL DEFAULT 'DURATION';
