-- Configurable payout adjustments. A rule looks only at the clock, the calendar
-- or how much a market is moving; what it resolves to is locked into the trade.

-- CreateTable
CREATE TABLE `PayoutRule` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NULL,
    `assetClass` VARCHAR(191) NULL,
    `adjustment` INTEGER NOT NULL,
    `config` JSON NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `exclusive` BOOLEAN NOT NULL DEFAULT false,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PayoutRule_enabled_priority_idx`(`enabled`, `priority`),
    INDEX `PayoutRule_assetId_enabled_idx`(`assetId`, `enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PayoutRule` ADD CONSTRAINT `PayoutRule_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
