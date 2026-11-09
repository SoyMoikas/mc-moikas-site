-- Player guides (markdown) per server, shown on /guide?id=<server>. Run in the D1 console before pushing.
ALTER TABLE servers ADD COLUMN guide TEXT;
ALTER TABLE servers ADD COLUMN guide_es TEXT;
