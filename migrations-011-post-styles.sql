ALTER TABLE social_posts ADD COLUMN style TEXT;
ALTER TABLE social_posts ADD COLUMN bg TEXT;
UPDATE social_posts SET bg = (SELECT eq_banner FROM users WHERE users.id = social_posts.user_id) WHERE bg IS NULL;
