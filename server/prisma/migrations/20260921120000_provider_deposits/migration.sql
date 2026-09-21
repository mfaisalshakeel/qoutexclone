-- A card/e-wallet deposit is completed by an incoming webhook, which needs to
-- find the deposit it is about. `externalRef` is the provider's own reference
-- for the transfer (a checkout session id), unique so the lookup is exact.

-- AlterTable
ALTER TABLE `Deposit` ADD COLUMN `externalRef` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Deposit_externalRef_key` ON `Deposit`(`externalRef`);
