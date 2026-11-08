// Built avatars: layered parts on a 100×100 canvas, drawn bottom → top in PART_SLOTS order.
//
// To add a new kind of part (hair, nose, clothes…):
//   1. add its slot name to PART_SLOTS here AND in lib/catalog.js (order = drawing order),
//   2. add labels "av.slot.<name>" in i18n.js,
//   3. add built-in drawings to ART below (or just use PNG images: 256×256 transparent, same canvas as the whole avatar),
//   4. create store items of type "Avatar part" with that slot in Admin → Store.
//
// Built-in drawings use `currentColor` for the body colour and INK for features.
export const PART_SLOTS = ["shape", "eyes", "brows", "mouth"];
export const REQUIRED_SLOTS = ["shape"]; // the rest can be left empty
export const DEFAULT_COLORS = { body: "#f2c14e", bg: "#2a3350" };

const INK = "#211d2b";
const LINE = `fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"`;

export const ART = {
  // ---- shapes (the body; filled with the player's body colour)
  shape_round: `<circle cx="50" cy="54" r="38" fill="currentColor"/>`,
  shape_square: `<rect x="13" y="16" width="74" height="74" rx="18" fill="currentColor"/>`,
  shape_cube: `<rect x="14" y="17" width="72" height="72" rx="3" fill="currentColor"/><rect x="14" y="17" width="72" height="10" fill="#000" opacity=".12"/>`,
  shape_blob: `<path d="M50 14c20 0 36 12 37 33 1 22-11 41-35 42-26 1-40-16-39-38 1-21 15-37 37-37z" fill="currentColor"/>`,
  shape_cat: `<path d="M18 30 L22 8 L40 22 Z M82 30 L78 8 L60 22 Z" fill="currentColor"/><circle cx="50" cy="56" r="36" fill="currentColor"/>`,
  shape_ghost: `<path d="M18 92V48c0-19 14-34 32-34s32 15 32 34v44l-8-7-8 7-8-7-8 7-8-7-8 7-8-7z" fill="currentColor"/>`,
  // ---- eyes
  eyes_dots: `<circle cx="38" cy="50" r="5" fill="${INK}"/><circle cx="62" cy="50" r="5" fill="${INK}"/>`,
  eyes_big: `<circle cx="37" cy="50" r="9" fill="#fff"/><circle cx="63" cy="50" r="9" fill="#fff"/><circle cx="39" cy="51" r="4.5" fill="${INK}"/><circle cx="65" cy="51" r="4.5" fill="${INK}"/>`,
  eyes_happy: `<path d="M31 53q7-9 14 0M55 53q7-9 14 0" ${LINE}/>`,
  eyes_sleepy: `<path d="M31 51h13M56 51h13" ${LINE}/>`,
  eyes_wink: `<circle cx="38" cy="50" r="5" fill="${INK}"/><path d="M55 52q7-7 14 0" ${LINE}/>`,
  // ---- brows
  brows_flat: `<path d="M31 38h13M56 38h13" ${LINE}/>`,
  brows_angry: `<path d="M30 35l14 5M70 35l-14 5" ${LINE}/>`,
  brows_worried: `<path d="M30 40l14-5M70 40l-14-5" ${LINE}/>`,
  // ---- mouths
  mouth_smile: `<path d="M38 66q12 11 24 0" ${LINE}/>`,
  mouth_grin: `<path d="M35 64h30q-2 15-15 15T35 64z" fill="${INK}"/><path d="M38 64h24v4H38z" fill="#fff"/>`,
  mouth_o: `<circle cx="50" cy="70" r="6" fill="${INK}"/>`,
  mouth_flat: `<path d="M40 69h20" ${LINE}/>`,
  mouth_tongue: `<path d="M38 66q12 11 24 0" ${LINE}/><path d="M46 71h10v4a5 5 0 0 1-10 0z" fill="#ff6b8a"/>`,
  mouth_cat: `<path d="M38 66q6 7 12 0q6 7 12 0" ${LINE}/>`,
};
export const ART_IDS = Object.keys(ART);
