-- The notification centre. One row per thing a trader is told about.
--
-- `dedupeKey` is the natural key of the event (a trade id and its settlement, a
-- deposit's credit, a support message) and is unique per trader, so a retried
-- webhook, a second sweeper pass or a restart mid-write can only ever produce
-- one notification for the same event. It is nullable because a notification
-- written by hand has no event behind it, and MySQL allows many NULLs in a
-- unique index.

-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `href` VARCHAR(191) NULL,
    `dedupeKey` VARCHAR(191) NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Notification_userId_dedupeKey_key`(`userId`, `dedupeKey`),
    INDEX `Notification_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `Notification_userId_readAt_idx`(`userId`, `readAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
