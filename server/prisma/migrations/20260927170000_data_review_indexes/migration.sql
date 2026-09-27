-- AlterTable
ALTER TABLE `Asset` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- CreateIndex
CREATE INDEX `AuditLog_action_createdAt_idx` ON `AuditLog`(`action`, `createdAt`);

-- CreateIndex
CREATE INDEX `Deposit_createdAt_idx` ON `Deposit`(`createdAt`);

-- CreateIndex
CREATE INDEX `ReferralCommission_createdAt_idx` ON `ReferralCommission`(`createdAt`);

-- CreateIndex
CREATE INDEX `RefreshToken_expiresAt_idx` ON `RefreshToken`(`expiresAt`);

-- CreateIndex
CREATE INDEX `Transaction_createdAt_idx` ON `Transaction`(`createdAt`);

-- CreateIndex
CREATE INDEX `User_role_status_idx` ON `User`(`role`, `status`);

-- CreateIndex
CREATE INDEX `User_role_kycStatus_idx` ON `User`(`role`, `kycStatus`);

-- CreateIndex
CREATE INDEX `Withdrawal_txHash_idx` ON `Withdrawal`(`txHash`);
