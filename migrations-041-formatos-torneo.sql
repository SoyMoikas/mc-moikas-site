-- 041: more tournament formats (double elim, round robin, swiss, king of the hill, best-of). Paste as one line in the D1 console; run once.
ALTER TABLE tournament_matches ADD COLUMN stage TEXT;
ALTER TABLE tournament_matches ADD COLUMN win_to TEXT;
ALTER TABLE tournament_matches ADD COLUMN lose_to TEXT;
ALTER TABLE tournaments ADD COLUMN config TEXT;
