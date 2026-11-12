-- 038: custom/hidden castigos for the ruleta + tab hover effects in the store (users.eq_tabfx). Paste as one line in the D1 console; run once.
CREATE TABLE IF NOT EXISTS dare_custom ( id INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT NOT NULL, level INTEGER NOT NULL, text TEXT NOT NULL, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at INTEGER NOT NULL );
CREATE TABLE IF NOT EXISTS dare_hidden ( game TEXT NOT NULL, text TEXT NOT NULL, hidden_by INTEGER, created_at INTEGER NOT NULL, PRIMARY KEY (game, text) );
ALTER TABLE users ADD COLUMN eq_tabfx TEXT;
INSERT OR IGNORE INTO store_items (id, type, name, name_es, visual, price, level, reward_level, active, sort_order, created_at, updated_at) VALUES
 ('tabfx_lift', 'tabfx', 'Lift', 'Elevar', '{"fx":"lift"}', NULL, 0, 3, 1, 1, strftime('%s','now')*1000, strftime('%s','now')*1000),
 ('tabfx_underline', 'tabfx', 'Sliding underline', 'Subrayado deslizante', '{"fx":"underline"}', 60, 0, NULL, 1, 2, strftime('%s','now')*1000, strftime('%s','now')*1000),
 ('tabfx_glow', 'tabfx', 'Glow', 'Brillo', '{"fx":"glow"}', 80, 0, NULL, 1, 3, strftime('%s','now')*1000, strftime('%s','now')*1000),
 ('tabfx_bounce', 'tabfx', 'Bounce', 'Rebote', '{"fx":"bounce"}', 100, 0, NULL, 1, 4, strftime('%s','now')*1000, strftime('%s','now')*1000),
 ('tabfx_shake', 'tabfx', 'Wiggle', 'Temblor', '{"fx":"shake"}', 100, 0, NULL, 1, 5, strftime('%s','now')*1000, strftime('%s','now')*1000),
 ('tabfx_pixel', 'tabfx', 'Pixel pop', 'Pixel 3D', '{"fx":"pixel","color":"#f2c94c"}', 150, 0, NULL, 1, 6, strftime('%s','now')*1000, strftime('%s','now')*1000),
 ('tabfx_neon', 'tabfx', 'Neon flicker', 'Neón parpadeante', '{"fx":"neon","color":"#4cf2e6"}', 200, 0, NULL, 1, 7, strftime('%s','now')*1000, strftime('%s','now')*1000),
 ('tabfx_rainbow', 'tabfx', 'Rainbow', 'Arcoíris', '{"fx":"rainbow"}', 300, 0, NULL, 1, 8, strftime('%s','now')*1000, strftime('%s','now')*1000);
