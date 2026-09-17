-- AlterTable
ALTER TABLE `Asset` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- CreateTable
CREATE TABLE `Candle` (
    `symbol` VARCHAR(191) NOT NULL,
    `timeframe` VARCHAR(191) NOT NULL,
    `time` INTEGER NOT NULL,
    `open` DOUBLE NOT NULL,
    `high` DOUBLE NOT NULL,
    `low` DOUBLE NOT NULL,
    `close` DOUBLE NOT NULL,

    INDEX `Candle_symbol_timeframe_time_idx`(`symbol`, `timeframe`, `time` DESC),
    INDEX `Candle_timeframe_time_idx`(`timeframe`, `time`),
    PRIMARY KEY (`symbol`, `timeframe`, `time`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
