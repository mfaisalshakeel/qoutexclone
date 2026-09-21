-- Payment methods behind the PaymentProvider interface. The provider's
-- mechanics live in code; what an operator can change without a deploy lives
-- here: whether a method is offered, its fees, its limits, its countries.

-- CreateTable
CREATE TABLE `PaymentMethod` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `network` VARCHAR(191) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `feePct` DOUBLE NOT NULL DEFAULT 0,
    `feeFlatCents` INTEGER NOT NULL DEFAULT 0,
    `minDepositCents` INTEGER NOT NULL DEFAULT 0,
    `maxDepositCents` INTEGER NOT NULL DEFAULT 0,
    `minWithdrawCents` INTEGER NOT NULL DEFAULT 0,
    `maxWithdrawCents` INTEGER NOT NULL DEFAULT 0,
    `countries` JSON NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PaymentMethod_key_key`(`key`),
    INDEX `PaymentMethod_provider_enabled_sortOrder_idx`(`provider`, `enabled`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
