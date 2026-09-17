-- Moves the original crypto markets onto the exchange's own convention
-- (BTC/USDT rather than BTC/USD), which is what the catalogue and the live
-- feed use. `Trade.symbol` is a denormalised display copy, so it is renamed in
-- step with the assets to keep existing history readable; `Trade.assetId`
-- already carried the real link and is untouched.

UPDATE `Asset`
SET `symbol` = CONCAT(`base`, 'USDT'),
    `quote` = 'USDT',
    `pair` = CONCAT(`base`, '/USDT')
WHERE `assetClass` = 'CRYPTO'
  AND `quote` = 'USD'
  AND `symbol` = CONCAT(`base`, 'USD');

UPDATE `Trade` t
JOIN `Asset` a ON a.`id` = t.`assetId`
SET t.`symbol` = a.`symbol`
WHERE t.`symbol` <> a.`symbol`;
