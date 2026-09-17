-- The trend term is sized by the regime's full length, so that length has to
-- survive a restart alongside what is left of it. Existing rows fall back to
-- their remaining ticks, which is the best answer available for a regime that
-- is already running.

-- AlterTable
ALTER TABLE `OtcMarketState` ADD COLUMN `regimeTicks` INTEGER NOT NULL DEFAULT 0;

UPDATE `OtcMarketState` SET `regimeTicks` = GREATEST(`regimeTicksLeft`, 1);
