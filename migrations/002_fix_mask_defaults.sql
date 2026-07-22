-- Fix mask defaults: remove left/right black bars, keep only top/bottom
UPDATE providers SET mask_left = 0 WHERE mask_left = 210;
UPDATE providers SET mask_right = 0 WHERE mask_right = 210;
