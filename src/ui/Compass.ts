// Brújula en la parte de arriba (azul). El norte es hacia donde miras al empezar.
const SPAN = 140; // grados que se ven a la vez
const LETTERS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };

export class Compass {
  private canvas = document.getElementById('compass') as HTMLCanvasElement;
  private ctx = this.canvas.getContext('2d')!;
  private last = -999;
  private w = 0;
  private h = 0;
  private dpr = 1;

  constructor() {
    window.addEventListener('resize', () => { this.last = -999; });
  }

  private fit() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (r.width === 0) return false;
    if (Math.round(r.width * dpr) !== this.canvas.width || Math.round(r.height * dpr) !== this.canvas.height) {
      this.canvas.width = Math.round(r.width * dpr);
      this.canvas.height = Math.round(r.height * dpr);
    }
    this.w = r.width; this.h = r.height; this.dpr = dpr;
    return true;
  }

  /** `yaw` en radianes (como lo usa el juego). Girar a la derecha aumenta el rumbo. */
  draw(yaw: number) {
    let heading = ((-yaw * 180) / Math.PI) % 360;
    if (heading < 0) heading += 360;
    if (Math.abs(heading - this.last) < 0.15) return;
    if (!this.fit()) return;
    this.last = heading;
    const { ctx, w, h, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Banda tenue de fondo, que se desvanece por los lados
    const band = ctx.createLinearGradient(0, 0, w, 0);
    band.addColorStop(0, 'rgba(20,60,110,0)');
    band.addColorStop(0.5, 'rgba(20,60,110,0.28)');
    band.addColorStop(1, 'rgba(20,60,110,0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, 9, w, 24);

    // Sombra suave para que se lea sobre el cielo claro
    ctx.shadowColor = 'rgba(0,10,30,0.7)';
    ctx.shadowBlur = 3;
    const fade = (x: number) => Math.max(0, 1 - Math.pow(Math.abs(x - w / 2) / (w / 2), 2.2));
    const xOf = (deg: number) => w / 2 + ((deg - heading) / SPAN) * w;
    const start = Math.floor((heading - SPAN / 2) / 5) * 5;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let d = start; d <= heading + SPAN / 2 + 5; d += 5) {
      const x = xOf(d);
      const a = fade(x);
      if (a <= 0.02) continue;
      const n = ((d % 360) + 360) % 360;
      const letter = LETTERS[n];
      const big = n % 15 === 0;
      ctx.strokeStyle = `rgba(120,200,255,${0.75 * a})`;
      ctx.lineWidth = big ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 33);
      ctx.lineTo(x, 33 - (big ? 8 : 4.5));
      ctx.stroke();
      if (letter) {
        ctx.font = `bold ${letter.length > 1 ? 14 : 17}px sans-serif`;
        ctx.fillStyle = n === 0 ? `rgba(210,238,255,${a})` : `rgba(130,205,255,${a})`;
        ctx.fillText(letter, x, 16);
      } else if (n % 15 === 0 && n % 45 !== 0) {
        ctx.font = '11px sans-serif';
        ctx.fillStyle = `rgba(130,205,255,${0.8 * a})`;
        ctx.fillText(String(n), x, 16);
      }
    }
    // Marca central
    ctx.fillStyle = 'rgba(190,230,255,0.95)';
    ctx.beginPath();
    ctx.moveTo(w / 2 - 5, 1);
    ctx.lineTo(w / 2 + 5, 1);
    ctx.lineTo(w / 2, 8);
    ctx.closePath();
    ctx.fill();
    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(150,215,255,0.85)';
    ctx.fillText(String(Math.round(heading) % 360).padStart(3, '0') + '°', w / 2, 41);
  }
}
