// Brújula en la parte de arriba (azul). El norte es hacia donde miras al empezar.
const SPAN = 140; // grados que se ven a la vez
const LETTERS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };

/** Un droide visto desde la brújula: su rumbo (0–360°) y su distancia en metros. */
export interface CompassMarker { bearing: number; dist: number }

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

  /** `yaw` en radianes (como lo usa el juego). Girar a la derecha aumenta el rumbo. Los marcadores son los droides. */
  draw(yaw: number, markers: CompassMarker[] = []) {
    let heading = ((-yaw * 180) / Math.PI) % 360;
    if (heading < 0) heading += 360;
    if (markers.length === 0 && Math.abs(heading - this.last) < 0.15) return;
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
    ctx.fillText(String(Math.round(heading) % 360).padStart(3, '0') + '°', w / 2, 53);

    // Droides: triángulos rojos en su dirección (más intensos cuanto más cerca).
    // Los que quedan fuera de la vista se señalan con una flecha en el borde, hacia el lado por el que girar.
    let nearL = Infinity, nearR = Infinity;
    for (const m of markers) {
      const delta = ((((m.bearing - heading) % 360) + 540) % 360) - 180;
      const a = 0.45 + 0.55 * Math.max(0, Math.min(1, 1 - m.dist / 140));
      if (Math.abs(delta) <= SPAN / 2) {
        const x = w / 2 + (delta / SPAN) * w;
        const s = m.dist < 25 ? 5.5 : 4.2;
        ctx.fillStyle = `rgba(255,86,66,${a})`;
        ctx.beginPath();
        ctx.moveTo(x - s, 48);
        ctx.lineTo(x + s, 48);
        ctx.lineTo(x, 48 - s * 1.6);
        ctx.closePath();
        ctx.fill();
      } else if (delta > 0) nearR = Math.min(nearR, m.dist);
      else nearL = Math.min(nearL, m.dist);
    }
    for (const [near, side] of [[nearL, -1], [nearR, 1]] as const) {
      if (!isFinite(near)) continue;
      const x = side < 0 ? 9 : w - 9;
      ctx.fillStyle = `rgba(255,86,66,${0.5 + 0.5 * Math.max(0, Math.min(1, 1 - near / 140))})`;
      ctx.beginPath();
      ctx.moveTo(x + side * 6, 43);
      ctx.lineTo(x - side * 3, 37);
      ctx.lineTo(x - side * 3, 49);
      ctx.closePath();
      ctx.fill();
    }
  }
}
