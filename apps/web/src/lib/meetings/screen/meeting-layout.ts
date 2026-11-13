/*
 * How many columns the gallery takes, and how large each tile is, for the space the room has.
 *
 * TILES ARE LANDSCAPE. A camera sends a wide picture, and a grid that stretched each cell to fill the
 * room drew two people on a laptop as two tall strips, which reads like a phone held upright. So the
 * tile keeps the camera's shape and the arrangement is the one that makes it LARGEST: every column
 * count from one to the number of people is tried, and the one whose tile is biggest wins. A room of
 * two on a wide screen is two side by side; a room of six is three by two; a tall window stacks.
 *
 * Pure arithmetic, so the arrangement is a unit test rather than a meeting to sit in.
 */

/** The shape a camera sends, width over height. */
export const TILE_ASPECT = 16 / 9;

export interface TileArrangement {
  readonly columns: number;
  /** The width of one tile in pixels, whole. */
  readonly tileWidth: number;
  /** The height of one tile in pixels, whole. */
  readonly tileHeight: number;
}

/**
 * The arrangement that draws `count` tiles largest inside `width` by `height`, with `gap` between
 * neighbours. A space not measured yet (zero in either direction) answers one column and no size,
 * which the gallery reads as "let the grid decide" until the first measurement lands.
 */
export function arrangeTiles(
  count: number,
  width: number,
  height: number,
  gap: number,
  aspect: number = TILE_ASPECT,
): TileArrangement {
  const people = Math.max(1, Math.floor(count));
  if (width <= 0 || height <= 0)
    return { columns: Math.min(people, 2), tileWidth: 0, tileHeight: 0 };

  let best: TileArrangement = { columns: 1, tileWidth: 0, tileHeight: 0 };
  for (let columns = 1; columns <= people; columns += 1) {
    const rows = Math.ceil(people / columns);
    const widthPerTile = (width - gap * (columns - 1)) / columns;
    const heightPerTile = (height - gap * (rows - 1)) / rows;
    if (widthPerTile <= 0 || heightPerTile <= 0) continue;
    // The tile is as wide as its cell allows, unless that would make it taller than its row.
    const tileWidth = Math.floor(Math.min(widthPerTile, heightPerTile * aspect));
    const tileHeight = Math.floor(tileWidth / aspect);
    if (tileWidth > best.tileWidth) best = { columns, tileWidth, tileHeight };
  }
  return best;
}
