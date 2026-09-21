-- Admin dashboard period comparisons (registrations, deposit/withdrawal
-- volume, bonuses paid) filter by a status plus a settlement timestamp over
-- an arbitrary date range, which the existing indexes don't cover.

-- CreateIndex
CREATE INDEX `User_createdAt_idx` ON `User`(`createdAt`);

-- CreateIndex
CREATE INDEX `Deposit_status_confirmedAt_idx` ON `Deposit`(`status`, `confirmedAt`);

-- CreateIndex
CREATE INDEX `Withdrawal_status_processedAt_idx` ON `Withdrawal`(`status`, `processedAt`);

-- CreateIndex
CREATE INDEX `PromoRedemption_createdAt_idx` ON `PromoRedemption`(`createdAt`);
