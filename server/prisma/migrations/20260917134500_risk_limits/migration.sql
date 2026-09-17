-- Per-market risk limits on new positions. 0 means "fall back to the runtime
-- setting", which itself may be 0 for no limit, so existing markets keep
-- behaving exactly as they did.

-- AlterTable
ALTER TABLE `Asset`
    ADD COLUMN `maxOpenStakePerUser` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `maxExposurePerDirection` INTEGER NOT NULL DEFAULT 0;

-- Open positions are aggregated by market and direction on every new trade.
CREATE INDEX `Trade_assetId_status_direction_idx` ON `Trade`(`assetId`, `status`, `direction`);
