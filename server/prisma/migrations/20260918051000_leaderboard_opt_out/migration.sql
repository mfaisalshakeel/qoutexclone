-- A trader can keep themselves off the public leaderboard. Default false, so
-- existing accounts behave as they did; the choice is theirs to make either way.

-- AlterTable
ALTER TABLE `User` ADD COLUMN `leaderboardOptOut` BOOLEAN NOT NULL DEFAULT false;

-- The leaderboard sums today's settled positions per trader.
CREATE INDEX `Trade_status_settledAt_idx` ON `Trade`(`status`, `settledAt`);
