-- Limits a trader sets on themselves. Tightening applies at once; loosening
-- waits out a cooling-off period, which is the point of setting it at all.

-- CreateTable
CREATE TABLE `ResponsibleLimits` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `dailyLossCents` INTEGER NOT NULL DEFAULT 0,
    `dailyDepositCents` INTEGER NOT NULL DEFAULT 0,
    `sessionReminderMin` INTEGER NOT NULL DEFAULT 0,
    `pending` JSON NULL,
    `pendingAt` DATETIME(3) NULL,
    `excludedUntil` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ResponsibleLimits_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ResponsibleLimits` ADD CONSTRAINT `ResponsibleLimits_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
