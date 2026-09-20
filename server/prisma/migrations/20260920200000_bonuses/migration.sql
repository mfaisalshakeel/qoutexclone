-- Bonuses with a turnover requirement. The money is credited to the balance as
-- before; what a Bonus row holds back is the right to withdraw it.

-- AlterTable
ALTER TABLE `Deposit` ADD COLUMN `bonusOfferId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `BonusOffer` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `percent` DOUBLE NOT NULL,
    `maxBonusCents` INTEGER NOT NULL,
    `minDepositCents` INTEGER NOT NULL DEFAULT 0,
    `turnoverMultiplier` INTEGER NOT NULL DEFAULT 20,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BonusOffer_key_key`(`key`),
    INDEX `BonusOffer_enabled_sortOrder_idx`(`enabled`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Bonus` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `offerId` VARCHAR(191) NULL,
    `source` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `required` INTEGER NOT NULL,
    `staked` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `note` VARCHAR(191) NULL,
    `depositId` VARCHAR(191) NULL,
    `releasedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Bonus_userId_status_idx`(`userId`, `status`),
    INDEX `Bonus_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Bonus` ADD CONSTRAINT `Bonus_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Bonus` ADD CONSTRAINT `Bonus_offerId_fkey` FOREIGN KEY (`offerId`) REFERENCES `BonusOffer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
