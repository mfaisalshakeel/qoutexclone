-- AlterTable
ALTER TABLE `Asset` ADD COLUMN `scheduleId` VARCHAR(191) NULL,
    ALTER COLUMN `updatedAt` DROP DEFAULT;

-- CreateTable
CREATE TABLE `TradingSchedule` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TradingSchedule_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ScheduleWindow` (
    `id` VARCHAR(191) NOT NULL,
    `scheduleId` VARCHAR(191) NOT NULL,
    `dayOfWeek` INTEGER NOT NULL,
    `openMinute` INTEGER NOT NULL,
    `closeMinute` INTEGER NOT NULL,

    INDEX `ScheduleWindow_scheduleId_dayOfWeek_idx`(`scheduleId`, `dayOfWeek`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketHoliday` (
    `id` VARCHAR(191) NOT NULL,
    `scheduleId` VARCHAR(191) NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MarketHoliday_date_idx`(`date`),
    UNIQUE INDEX `MarketHoliday_scheduleId_date_key`(`scheduleId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Asset_scheduleId_idx` ON `Asset`(`scheduleId`);

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `TradingSchedule`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScheduleWindow` ADD CONSTRAINT `ScheduleWindow_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `TradingSchedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketHoliday` ADD CONSTRAINT `MarketHoliday_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `TradingSchedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
