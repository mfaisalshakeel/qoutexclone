-- Account security: a confirmed address, an optional second factor, a device
-- list the trader can see, and the mail that went out about any of it.

-- AlterTable
ALTER TABLE `User`
  ADD COLUMN `emailVerifiedAt` DATETIME(3) NULL,
  ADD COLUMN `twoFactorSecret` VARCHAR(191) NULL,
  ADD COLUMN `twoFactorPending` VARCHAR(191) NULL,
  ADD COLUMN `twoFactorEnabledAt` DATETIME(3) NULL;

-- AlterTable: a session is a device, so it carries what it was opened from
ALTER TABLE `RefreshToken`
  ADD COLUMN `ip` VARCHAR(191) NULL,
  ADD COLUMN `userAgent` TEXT NULL,
  ADD COLUMN `device` VARCHAR(191) NULL,
  ADD COLUMN `fingerprint` VARCHAR(191) NULL,
  ADD COLUMN `lastUsedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `EmailVerificationToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EmailVerificationToken_tokenHash_key`(`tokenHash`),
    INDEX `EmailVerificationToken_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BackupCode` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BackupCode_userId_usedAt_idx`(`userId`, `usedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: login history, kept for failures too
CREATE TABLE `LoginEvent` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `email` VARCHAR(191) NOT NULL,
    `outcome` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `device` VARCHAR(191) NOT NULL,
    `fingerprint` VARCHAR(191) NOT NULL,
    `newDevice` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LoginEvent_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `LoginEvent_userId_fingerprint_outcome_idx`(`userId`, `fingerprint`, `outcome`),
    INDEX `LoginEvent_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: the outbox, written before anything tries to deliver
CREATE TABLE `EmailMessage` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `to` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `template` VARCHAR(191) NOT NULL,
    `html` TEXT NOT NULL,
    `text` TEXT NOT NULL,
    `transport` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'QUEUED',
    `error` TEXT NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EmailMessage_createdAt_idx`(`createdAt`),
    INDEX `EmailMessage_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EmailVerificationToken` ADD CONSTRAINT `EmailVerificationToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `BackupCode` ADD CONSTRAINT `BackupCode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LoginEvent` ADD CONSTRAINT `LoginEvent_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `EmailMessage` ADD CONSTRAINT `EmailMessage_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
