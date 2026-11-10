import { CanvasTexture, DoubleSide, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import { CSS } from './palette.ts';

export interface TextLine {
  text: string;
  size?: number; // px at canvas resolution
  color?: string;
  mono?: boolean;
  bold?: boolean;
  gap?: number; // extra px after the line
}

export interface TextPanelOptions {
  width: number; // meters
  height: number; // meters
  pxPerMeter?: number;
  background?: string | null;
  border?: string | null;
  radius?: number; // px
  padding?: number; // px
  align?: 'left' | 'center';
}

/**
 * World-space text rendered into a CanvasTexture (ADR-0013: P0 text system).
 * Redraws only when content changes; one draw call per panel.
 */
export class TextPanel {
  /** Count of draws where text still did not fit at 60% scale (checked by the scene harness). */
  static clipEvents: string[] = [];
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private key = '';

  constructor(private readonly opts: TextPanelOptions) {
    const ppm = opts.pxPerMeter ?? 1400;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(opts.width * ppm);
    this.canvas.height = Math.round(opts.height * ppm);
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    const material = new MeshBasicMaterial({ map: this.texture, transparent: true, side: DoubleSide, depthWrite: false });
    this.mesh = new Mesh(new PlaneGeometry(opts.width, opts.height), material);
  }

  draw(lines: readonly TextLine[], background?: string | null): void {
    const key = JSON.stringify([lines, background]);
    if (key === this.key) return;
    this.key = key;
    const { ctx, canvas } = this;
    const pad = this.opts.padding ?? 28;
    const radius = this.opts.radius ?? 24;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const bg = background === undefined ? (this.opts.background ?? CSS.panelBg) : background;
    if (bg) {
      ctx.fillStyle = bg;
      roundRect(ctx, 2, 2, canvas.width - 4, canvas.height - 4, radius);
      ctx.fill();
      if (this.opts.border !== null) {
        ctx.strokeStyle = this.opts.border ?? CSS.panelBorder;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
    const maxWidth = canvas.width - pad * 2;
    const maxHeight = canvas.height - pad * 1.5;
    // Shrink-to-fit: scale every line down (to 60% at most) until the block fits, and shrink
    // any single centered line that is too wide. Text is never silently clipped unless even
    // 60% does not fit.
    let wrapped: Array<TextLine & { text: string; size: number }> = [];
    let total = 0;
    for (let scale = 1; scale >= 0.6 - 1e-9; scale -= 0.1) {
      wrapped = [];
      for (const line of lines) {
        let size = (line.size ?? 40) * scale;
        if (this.opts.align === 'center') {
          ctx.font = font({ ...line, size });
          const w = ctx.measureText(line.text).width;
          if (w > maxWidth) size = Math.max(size * 0.6, (size * maxWidth) / w);
        }
        ctx.font = font({ ...line, size });
        const pieces = this.opts.align === 'center' ? [line.text] : wrap(ctx, line.text, maxWidth, line.mono ?? false);
        pieces.forEach((piece, i) => wrapped.push({ ...line, text: piece, size, gap: i === pieces.length - 1 ? (line.gap ?? 0) * scale : 0 }));
      }
      total = wrapped.reduce((h, l) => h + l.size * 1.3 + (l.gap ?? 0), 0);
      if (total <= maxHeight) break;
    }
    let y = this.opts.align === 'center' ? Math.max(pad / 2, (canvas.height - total) / 2) : pad;
    for (const line of wrapped) {
      if (y + line.size > canvas.height - pad / 4) {
        TextPanel.clipEvents.push(lines.map((l) => l.text).join(' | ').slice(0, 160));
        break; // last resort: clip rather than overflow
      }
      ctx.font = font(line);
      ctx.fillStyle = line.color ?? CSS.text;
      ctx.textBaseline = 'top';
      if (this.opts.align === 'center') {
        ctx.textAlign = 'center';
        ctx.fillText(line.text, canvas.width / 2, y);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(line.text, pad, y);
      }
      y += line.size * 1.3 + (line.gap ?? 0);
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

function font(l: TextLine): string {
  const family = l.mono ? 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace' : 'system-ui, "Segoe UI", Roboto, sans-serif';
  return `${l.bold ? '600 ' : ''}${l.size ?? 40}px ${family}`;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, mono: boolean): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (mono) {
      // Code: truncate instead of wrapping so line structure stays readable.
      let s = para;
      while (s.length > 1 && ctx.measureText(s).width > maxWidth) s = s.slice(0, -1);
      out.push(s.length < para.length ? `${s.slice(0, -1)}…` : s);
      continue;
    }
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
