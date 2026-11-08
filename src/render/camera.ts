import { WORLD_HEIGHT, WORLD_WIDTH } from '../data/map';

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const MAX_ZOOM_FACTOR = 6;
const OVERSCROLL = 80;

/** Maps world units to CSS pixels. `x` and `y` are the world point at screen 0,0. */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  width = 1;
  height = 1;
  private fitZoom = 1;
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

  resize(width: number, height: number, insets: Insets): void {
    this.width = width;
    this.height = height;
    this.insets = insets;
    const availableW = Math.max(1, width - insets.left - insets.right);
    const availableH = Math.max(1, height - insets.top - insets.bottom);
    this.fitZoom = Math.min(availableW / WORLD_WIDTH, availableH / WORLD_HEIGHT);
  }

  /** Frames the whole map inside the area not covered by the HUD. */
  fit(): void {
    this.zoom = this.fitZoom;
    const availableW = this.width - this.insets.left - this.insets.right;
    const availableH = this.height - this.insets.top - this.insets.bottom;
    this.x = -(this.insets.left + (availableW - WORLD_WIDTH * this.zoom) / 2) / this.zoom;
    this.y = -(this.insets.top + (availableH - WORLD_HEIGHT * this.zoom) / 2) / this.zoom;
  }

  worldX(screenX: number): number {
    return this.x + screenX / this.zoom;
  }

  worldY(screenY: number): number {
    return this.y + screenY / this.zoom;
  }

  panBy(screenDx: number, screenDy: number): void {
    this.x -= screenDx / this.zoom;
    this.y -= screenDy / this.zoom;
    this.clamp();
  }

  zoomAt(screenX: number, screenY: number, factor: number): void {
    const wx = this.worldX(screenX);
    const wy = this.worldY(screenY);
    const min = this.fitZoom;
    const max = this.fitZoom * MAX_ZOOM_FACTOR;
    this.zoom = Math.min(max, Math.max(min, this.zoom * factor));
    this.x = wx - screenX / this.zoom;
    this.y = wy - screenY / this.zoom;
    this.clamp();
  }

  private clamp(): void {
    const viewW = this.width / this.zoom;
    const viewH = this.height / this.zoom;
    this.x = this.clampAxis(this.x, viewW, WORLD_WIDTH, this.insets.left / this.zoom, this.insets.right / this.zoom);
    this.y = this.clampAxis(this.y, viewH, WORLD_HEIGHT, this.insets.top / this.zoom, this.insets.bottom / this.zoom);
  }

  private clampAxis(value: number, view: number, world: number, insetStart: number, insetEnd: number): number {
    const margin = OVERSCROLL / this.zoom;
    const min = -insetStart - margin;
    const max = world - view + insetEnd + margin;
    return min > max ? (min + max) / 2 : Math.min(max, Math.max(min, value));
  }
}
