import { timingSafeEqual } from "./util.js";

export function syncAuthorized(request, env) {
  const auth = request.headers.get("authorization") || "";
  return !!env.SYNC_SECRET && timingSafeEqual(auth, `Bearer ${env.SYNC_SECRET}`);
}
