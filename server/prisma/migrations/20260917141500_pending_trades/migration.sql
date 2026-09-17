-- Orders that become positions when a price level is reached or a time arrives.
-- No money is held while one waits: it is not a position yet, so whatever would
-- refuse the trade at purchase refuses it at triggering, with the reason kept
-- on the order.

-- CreateTable
CREATE TABLE `PendingTrade` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(191) NOT NULL,
    `accountType` VARCHAR(191) NOT NULL,
    `entryId` VARCHAR(191) NULL,
    `tournamentId` VARCHAR(191) NULL,
    `direction` VARCHAR(191) NOT NULL,
    `stake` INTEGER NOT NULL,
    `trigger` VARCHAR(191) NOT NULL,
    `triggerPrice` DOUBLE NULL,
    `triggerSide` VARCHAR(191) NULL,
    `triggerAt` DATETIME(3) NULL,
    `expiryMode` VARCHAR(191) NOT NULL DEFAULT 'DURATION',
    `durationSec` INTEGER NULL,
    `expiresAt` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `goodUntil` DATETIME(3) NOT NULL,
    `tradeId` VARCHAR(191) NULL,
    `failureReason` VARCHAR(191) NULL,
    `triggeredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PendingTrade_tradeId_key`(`tradeId`),
    INDEX `PendingTrade_userId_status_idx`(`userId`, `status`),
    INDEX `PendingTrade_status_symbol_idx`(`status`, `symbol`),
    INDEX `PendingTrade_status_triggerAt_idx`(`status`, `triggerAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PendingTrade` ADD CONSTRAINT `PendingTrade_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PendingTrade` ADD CONSTRAINT `PendingTrade_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
