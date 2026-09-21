-- The dashboard's "active traders" KPI counts distinct real-account traders
-- who opened a position within a period; nothing indexed openedAt before.

-- CreateIndex
CREATE INDEX `Trade_accountType_openedAt_idx` ON `Trade`(`accountType`, `openedAt`);
