-- AlterTable
ALTER TABLE `Asset` ADD COLUMN `otcConfig` JSON NULL,
    ALTER COLUMN `updatedAt` DROP DEFAULT;

-- CreateTable
CREATE TABLE `OtcMarketState` (
    `symbol` VARCHAR(191) NOT NULL,
    `price` DOUBLE NOT NULL,
    `anchor` DOUBLE NOT NULL,
    `variance` DOUBLE NOT NULL,
    `lastShock` DOUBLE NOT NULL DEFAULT 0,
    `regime` VARCHAR(191) NOT NULL DEFAULT 'RANGE',
    `regimeTicksLeft` INTEGER NOT NULL DEFAULT 0,
    `trendDirection` INTEGER NOT NULL DEFAULT 1,
    `rng` INTEGER NOT NULL,
    `ticks` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`symbol`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
