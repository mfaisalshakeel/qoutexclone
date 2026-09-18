-- The trader's chart layout, so a workspace follows them between devices.
-- Null means the default single chart.

-- AlterTable
ALTER TABLE `User` ADD COLUMN `terminalLayout` JSON NULL;
