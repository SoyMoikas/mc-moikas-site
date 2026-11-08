import { str, HttpError } from "./util.js";

export const POST_COLS = `
  p.id, p.body, p.image, p.game_id, p.created_at, p.edited_at, p.user_id,
  u.username, u.avatar, u.role, u.xp, u.eq_frame, u.eq_hat, u.eq_color, u.eq_banner, u.eq_font, u.eq_text,
  g.name AS game_name, g.name_es AS game_name_es, g.icon AS game_icon,
  (SELECT COUNT(*) FROM social_likes l WHERE l.post_id = p.id) AS likes,
  (SELECT COUNT(*) FROM social_comments c WHERE c.post_id = p.id) AS comments`;

export const POST_FROM = `
  FROM social_posts p
  LEFT JOIN users u ON u.id = p.user_id
  LEFT JOIN games g ON g.id = p.game_id`;

export function postInput(b) {
  const body = str(b.body, 2000, "post");
  const image = str(b.image, 500, "image");
  if (image && !/^https:\/\/[^\s"'<>]+$/i.test(image)) throw new HttpError(400, "Image must be an https:// link");
  if (!body && !image) throw new HttpError(400, "Write something or add an image");
  return { body, image, game_id: str(b.game_id, 30, "game_id") };
}

// "For you" score: engagement that decays with age (newer + more liked/commented ranks higher).
export function score(p, now = Date.now()) {
  const hours = (now - p.created_at) / 3_600_000;
  return (1 + p.likes * 2 + p.comments * 3) / Math.pow(hours + 2, 1.4);
}

// Adds liked_by_me / can_edit / can_delete for the viewer.
export function decorate(rows, viewer, likedSet, isStaff) {
  return rows.map(({ user_id, ...p }) => ({
    ...p,
    author_id: user_id,
    liked: likedSet.has(p.id),
    mine: user_id === viewer.id,
    can_delete: user_id === viewer.id || isStaff,
  }));
}
