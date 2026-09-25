-- Rebuys and market scoping for tournaments
ALTER TABLE `Tournament`
  ADD COLUMN `rebuyEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `rebuyFee` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `rebuyLimit` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `allowedAssetIds` JSON NULL;

ALTER TABLE `TournamentEntry`
  ADD COLUMN `rebuys` INTEGER NOT NULL DEFAULT 0;
