-- Experience and achievements. XP is not money and never reaches a balance;
-- it lives on the user row, and a badge is one row the first time it is earned.

-- AlterTable
ALTER TABLE `User`
  ADD COLUMN `xp` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `xpLastDay` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `Achievement` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `unlockedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Achievement_userId_key_key`(`userId`, `key`),
    INDEX `Achievement_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Achievement` ADD CONSTRAINT `Achievement_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
