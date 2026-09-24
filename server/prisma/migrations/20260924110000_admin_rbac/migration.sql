-- Add adminRole to User (meaningful only when role = ADMIN)
ALTER TABLE `User` ADD COLUMN `adminRole` VARCHAR(191) NULL;
