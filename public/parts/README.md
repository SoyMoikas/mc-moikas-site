# Avatar part images

Optional: instead of the built-in drawings, a part can be a PNG.

- **256 × 256 px**, transparent background.
- Draw the part **where it sits on the whole avatar** (every layer uses the same canvas), so a
  mouth PNG is mostly empty with the mouth in the lower middle. Don't trim the empty space.
- Layers stack in this order: shape → eyes → brows → mouth.
- Shapes made from images don't take the player's body colour (built-in shapes do).

Put the file here, push, then Admin → Store → New item → **Avatar part**, choose the part,
set Drawing to "(use an image instead)" and Image to `/parts/<file>.png`.
