export const TILE = 40;
export const COLS = 48;
export const ROWS = 28;
export const WORLD_WIDTH = COLS * TILE;
export const WORLD_HEIGHT = ROWS * TILE;

export type TilePoint = [number, number];

export const enum PathId {
  Main,
  North,
  AirSouth,
  AirNorth,
}

/** Waypoints in tile coordinates. Entry points start just off the map. */
export const ROUTES: TilePoint[][] = [
  [[-2, 6], [8, 6], [8, 20], [18, 20], [18, 8], [30, 8], [30, 22], [40, 22], [40, 14], [46, 14]],
  [[24, -2], [24, 4], [36, 4], [36, 14], [46, 14]],
  [[-2, 25], [20, 18], [34, 16], [46, 14]],
  [[10, -2], [26, 8], [38, 12], [46, 14]],
];

/** Ground routes block construction. Air routes do not. */
export const GROUND_ROUTES = [PathId.Main, PathId.North];
export const BASE_TILE: TilePoint = [46, 14];
/** The North entrance opens on this wave. */
export const NORTH_ROUTE_WAVE = 16;
