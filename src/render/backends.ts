import { WORLD_HEIGHT, WORLD_WIDTH } from '../data/map';
import type { Atlas } from './atlas';
import { INSTANCE_BYTES, INSTANCE_FLOATS, MAX_INSTANCES, type InstanceBatch } from './batch';
import type { Camera } from './camera';

export interface Backend {
  readonly name: string;
  readonly canvas: HTMLCanvasElement;
  drawCalls: number;
  resize(pixelWidth: number, pixelHeight: number): void;
  present(batch: InstanceBatch, camera: Camera): void;
}

const VERTEX_SHADER = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec2 aPos;
layout(location=2) in vec2 aSize;
layout(location=3) in vec2 aDir;
layout(location=4) in vec4 aUv;
layout(location=5) in vec4 aColor;
uniform vec4 uView;
out vec2 vUv;
out vec4 vColor;
void main() {
  // The direction arrives unnormalized, which saves an atan2 per enemy in JS.
  float len = length(aDir);
  vec2 d = len > 0.0001 ? aDir / len : vec2(1.0, 0.0);
  vec2 local = aCorner * aSize;
  vec2 world = aPos + vec2(local.x * d.x - local.y * d.y, local.x * d.y + local.y * d.x);
  gl_Position = vec4((world.x - uView.x) * uView.z - 1.0, 1.0 - (world.y - uView.y) * uView.w, 0.0, 1.0);
  vUv = aUv.xy + (aCorner + 0.5) * aUv.zw;
  vColor = aColor;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
in vec2 vUv;
in vec4 vColor;
out vec4 outColor;
void main() {
  outColor = texture(uTex, vUv) * vColor;
}`;

const BUFFER_RING = 3;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    throw new Error(`Shader failed to compile: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

/** Draws the whole batch with one instanced call, plus one quad for the ground. */
export class WebGLBackend implements Backend {
  readonly name = 'WebGL2 instanced';
  drawCalls = 0;
  private gl: WebGL2RenderingContext;
  private viewLoc!: WebGLUniformLocation;
  private atlasTexture!: WebGLTexture;
  private groundTexture!: WebGLTexture;
  private vaos: WebGLVertexArrayObject[] = [];
  private buffers: WebGLBuffer[] = [];
  private groundVao!: WebGLVertexArrayObject;
  private groundBuffer!: WebGLBuffer;
  private ringIndex = 0;
  private lost = false;

  constructor(readonly canvas: HTMLCanvasElement, private atlas: Atlas, private ground: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.init();
      this.lost = false;
    });
    this.init();
  }

  static create(canvas: HTMLCanvasElement, atlas: Atlas, ground: HTMLCanvasElement): WebGLBackend | null {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance', desynchronized: false });
    return gl ? new WebGLBackend(canvas, atlas, ground, gl) : null;
  }

  private texture(source: HTMLCanvasElement, mipmaps: boolean): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
    return texture;
  }

  private init(): void {
    const gl = this.gl;
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    gl.useProgram(program);
    this.viewLoc = gl.getUniformLocation(program, 'uView')!;
    gl.uniform1i(gl.getUniformLocation(program, 'uTex'), 0);

    this.atlasTexture = this.texture(this.atlas.canvas, true);
    this.groundTexture = this.texture(this.ground, false);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.07, 0.09, 0.12, 1);

    const corners = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);

    // A ring of buffers means the GPU is never reading the one being written.
    this.vaos = [];
    this.buffers = [];
    for (let i = 0; i < BUFFER_RING; i++) {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, corners);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, MAX_INSTANCES * INSTANCE_BYTES, gl.STREAM_DRAW);
      this.setInstanceLayout();
      this.vaos.push(vao);
      this.buffers.push(buffer);
    }

    this.groundVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.groundVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.groundBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.groundBuffer);
    const c = 0xffffffff;
    const data = new Float32Array(INSTANCE_FLOATS);
    data.set([WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, 1, 0, 0, 0, 1, 1]);
    new Uint32Array(data.buffer)[10] = c;
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.setInstanceLayout();
    gl.bindVertexArray(null);
  }

  private setInstanceLayout(): void {
    const gl = this.gl;
    const attribute = (location: number, size: number, type: number, normalized: boolean, offset: number) => {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, type, normalized, INSTANCE_BYTES, offset);
      gl.vertexAttribDivisor(location, 1);
    };
    attribute(1, 2, gl.FLOAT, false, 0);
    attribute(2, 2, gl.FLOAT, false, 8);
    attribute(3, 2, gl.FLOAT, false, 16);
    attribute(4, 4, gl.FLOAT, false, 24);
    attribute(5, 4, gl.UNSIGNED_BYTE, true, 40);
  }

  resize(pixelWidth: number, pixelHeight: number): void {
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
    this.gl.viewport(0, 0, pixelWidth, pixelHeight);
  }

  present(batch: InstanceBatch, camera: Camera): void {
    this.drawCalls = 0;
    if (this.lost) return;
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform4f(this.viewLoc, camera.x, camera.y, (2 * camera.zoom) / camera.width, (2 * camera.zoom) / camera.height);

    gl.bindTexture(gl.TEXTURE_2D, this.groundTexture);
    gl.bindVertexArray(this.groundVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);

    this.ringIndex = (this.ringIndex + 1) % BUFFER_RING;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
    gl.bindVertexArray(this.vaos[this.ringIndex]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[this.ringIndex]);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.floats, 0, batch.count * INSTANCE_FLOATS);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batch.count);
    this.drawCalls = 2;
  }
}

/** Fallback and benchmark comparison: replays the same batch one draw at a time. */
export class CanvasBackend implements Backend {
  readonly name = 'Canvas2D';
  drawCalls = 0;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(readonly canvas: HTMLCanvasElement, private atlas: Atlas, private ground: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  resize(pixelWidth: number, pixelHeight: number): void {
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
  }

  present(batch: InstanceBatch, camera: Camera): void {
    const { ctx, atlas } = this;
    const size = atlas.canvas.width;
    this.dpr = this.canvas.width / camera.width;
    const scale = camera.zoom * this.dpr;
    const offX = -camera.x * scale;
    const offY = -camera.y * scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#12171f';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(scale, 0, 0, scale, offX, offY);
    ctx.drawImage(this.ground, 0, 0);

    const f = batch.floats;
    const colors = batch.uints;
    const solidU = atlas.solid.u;
    let additive = false;
    for (let n = 0; n < batch.count; n++) {
      const i = n * INSTANCE_FLOATS;
      const color = colors[i + 10];
      const alpha = color >>> 24;
      const isAdditive = alpha === 0;
      if (isAdditive !== additive) {
        additive = isAdditive;
        ctx.globalCompositeOperation = additive ? 'lighter' : 'source-over';
      }
      const r = color & 255;
      const g = (color >>> 8) & 255;
      const b = (color >>> 16) & 255;
      ctx.globalAlpha = isAdditive ? Math.max(r, g, b) / 255 : alpha / 255;
      const dx = f[i + 4];
      const dy = f[i + 5];
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const c = len > 0.0001 && (dx !== 0 || dy !== 0) ? dx / len : 1;
      const s = len > 0.0001 && (dx !== 0 || dy !== 0) ? dy / len : 0;
      ctx.setTransform(scale * c, scale * s, -scale * s, scale * c, offX + f[i] * scale, offY + f[i + 1] * scale);
      const w = f[i + 2];
      const h = f[i + 3];
      if (f[i + 6] === solidU) {
        const unpremultiply = alpha > 0 ? 255 / alpha : 1;
        ctx.fillStyle = `rgb(${r * unpremultiply},${g * unpremultiply},${b * unpremultiply})`;
        ctx.fillRect(-w / 2, -h / 2, w, h);
      } else {
        ctx.drawImage(atlas.canvas, f[i + 6] * size, f[i + 7] * size, f[i + 8] * size, f[i + 9] * size, -w / 2, -h / 2, w, h);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.drawCalls = batch.count + 1;
  }
}
