import { json, body, err } from "../../lib/util.js";
import { translateMany } from "../../lib/translate.js";

// POST {to: "es"|"en", texts: [...]} → {out: [...]}   (null = keep the original, undefined/missing = try again later)
// The page sends what people wrote (chat, posts, answers, comments) and shows the translation in the reader's language.
export async function onRequestPost({ env, request }) {
  const b = await body(request, 128 * 1024);
  if (b instanceof Response) return b;
  const to = b.to === "en" ? "en" : b.to === "es" ? "es" : null;
  if (!to) return err(400, "Unknown language");
  if (!Array.isArray(b.texts)) return err(400, "texts must be a list");
  const texts = b.texts.slice(0, 40).map((s) => String(s ?? "").slice(0, 1000));
  try {
    const { out, ai } = await translateMany(env, texts, to);
    // JSON drops undefined inside arrays as null, so send "later" as a separate list of positions
    const later = [];
    out.forEach((v, i) => { if (v === undefined) later.push(i); });
    return json({ out: out.map((v) => (v === undefined ? null : v)), later, ai });
  } catch (e) {
    return err(500, "Translation failed");
  }
}
