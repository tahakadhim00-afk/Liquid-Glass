/**
 * Backdrop capture.
 *
 * The glass shader needs the pixels *behind* the panel as a texture. The
 * browser gives us no way to read the composited page (that is exactly
 * what Apple can do on-device with Metal against the real frame buffer,
 * and the single biggest gap between their effect and ours).
 *
 * So we draw the backdrop ourselves into an offscreen canvas. This module
 * paints the demo scene: gradient mesh, colour blobs, photo tiles and
 * crisp text - deliberately high-contrast content, because refraction is
 * only visible when there is detail behind the glass to bend.
 *
 * Swap `PaintedBackdrop` for any object with the same interface to feed
 * the renderer a video frame, a WebGL scene, or an html2canvas raster.
 */

const TILE_COLORS = [
  '#ff5f6d', '#ffc371', '#24c6dc', '#514a9d',
  '#f7971e', '#43cea2', '#c94b4b', '#4776e6',
];

export class PaintedBackdrop {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.width = 0;
    this.height = 0;
    this.scrollY = 0;
    this._dirty = true;
  }

  get source() { return this.canvas; }

  /**
   * Use an image as the backdrop instead of the painted scene.
   * A photo is a far harder test than a synthetic gradient: real detail
   * and hard edges make any error in the refraction obvious.
   * @param {HTMLImageElement|ImageBitmap|null} image  null restores the scene
   */
  setImage(image) {
    this.image = image || null;
    this._dirty = true;
  }

  /** Draw the image cover-fit, cropping rather than distorting. */
  _paintImage(W, H) {
    const ctx = this.ctx;
    const img = this.image;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;

    const scale = Math.max(W / iw, H / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    // Centre horizontally; let vertical scroll pan the image a little so
    // the glass has moving content to refract.
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2 - (this.scrollY * 0.25);

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  resize(cssWidth, cssHeight, dpr) {
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (w === this.canvas.width && h === this.canvas.height) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this._dirty = true;
  }

  /** Content scrolls under the glass; mark dirty so we repaint. */
  setScroll(y) {
    if (Math.abs(y - this.scrollY) > 0.01) {
      this.scrollY = y;
      this._dirty = true;
    }
  }

  invalidate() { this._dirty = true; }

  /** Repaint only when something changed. Returns true if it redrew. */
  update(time) {
    if (!this._dirty && !this.animated) return false;
    this.paint(time);
    this._dirty = false;
    return true;
  }

  paint(time = 0) {
    const ctx = this.ctx;
    const dpr = this.dpr || 1;
    const W = this.cssWidth;
    const H = this.cssHeight;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    if (this.image) { this._paintImage(W, H); return; }

    // --- base gradient ------------------------------------------------
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#0b1020');
    g.addColorStop(0.5, '#131a35');
    g.addColorStop(1, '#1d1330');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const sy = this.scrollY;

    // --- soft colour blobs -------------------------------------------
    // Large, saturated and smooth: these show the refraction *sweep*.
    const blobs = [
      { x: 0.18, y: 0.22, r: 0.42, c: '#ff2d75' },
      { x: 0.82, y: 0.18, r: 0.38, c: '#00d4ff' },
      { x: 0.70, y: 0.78, r: 0.45, c: '#7b2dff' },
      { x: 0.28, y: 0.85, r: 0.36, c: '#ffb020' },
    ];
    ctx.globalCompositeOperation = 'lighter';
    for (const b of blobs) {
      const cx = b.x * W;
      const cy = b.y * H - sy * 0.35;
      const r = b.r * Math.min(W, H);
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      rg.addColorStop(0, b.c + 'cc');
      rg.addColorStop(0.5, b.c + '44');
      rg.addColorStop(1, b.c + '00');
      ctx.fillStyle = rg;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';

    // --- hard-edged tiles --------------------------------------------
    // Straight lines are the honest test: a bent straight edge is
    // unmistakably refraction, where a blurred one could be anything.
    const cols = 6;
    const tile = W / cols;
    ctx.save();
    ctx.translate(0, -((sy * 0.6) % (tile * 1.6)));
    for (let row = 0; row < Math.ceil(H / (tile * 1.6)) + 2; row++) {
      for (let col = 0; col < cols; col++) {
        if ((row + col) % 3 !== 0) continue;
        const x = col * tile + tile * 0.18;
        const y = row * tile * 1.6 + tile * 0.2;
        ctx.fillStyle = TILE_COLORS[(row * cols + col) % TILE_COLORS.length];
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.roundRect(x, y, tile * 0.64, tile * 0.64, 16);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // --- grid lines ---------------------------------------------------
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = 48;
    for (let x = 0; x <= W; x += step) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
    for (let y = -(sy % step); y <= H; y += step) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
    ctx.stroke();

    // --- text ---------------------------------------------------------
    // Small type behind glass is the readability test.
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `600 ${Math.round(W * 0.052)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText('Liquid Glass', W * 0.08, H * 0.10 - sy * 0.5);

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `400 15px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const lines = [
      'Refraction bends this text near the panel edges.',
      'Straight lines break; small type smears and re-forms.',
      'Drag the panel across the blobs and the tiles below.',
    ];
    lines.forEach((line, i) => {
      ctx.fillText(line, W * 0.08, H * 0.10 + W * 0.062 + i * 24 - sy * 0.5);
    });
  }
}
