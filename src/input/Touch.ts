import nipplejs from 'nipplejs';
import type { InputSource } from './types';

// Controles táctiles: joystick a la izquierda, deslizar a la derecha para mirar, botones.
export class Touch implements InputSource {
  static available() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  private mx = 0;
  private mz = 0;
  private dx = 0;
  private dy = 0;
  private lookId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private crouch = false;
  /** true cuando se ha tocado la pantalla hace poco (para saber qué control se está usando) */
  used = false;

  constructor(root: HTMLElement) {
    const joyZone = root.querySelector<HTMLElement>('#joyZone')!;
    const lookZone = root.querySelector<HTMLElement>('#lookZone')!;
    const btnCrouch = root.querySelector<HTMLElement>('#btnCrouch')!;

    const joy = nipplejs.create({
      zone: joyZone,
      mode: 'dynamic',
      size: 130,
      color: 'rgba(255,255,255,0.7)',
      fadeTime: 100,
    });
    joy.on('move', (evt) => {
      const v = evt.data.vector;
      const f = Math.min(1, evt.data.force);
      const len = Math.hypot(v.x, v.y) || 1;
      this.mx = (v.x / len) * f;
      this.mz = (v.y / len) * f;
      this.used = true;
    });
    joy.on('end', () => { this.mx = this.mz = 0; });

    const opts = { passive: false } as const;
    lookZone.addEventListener('touchstart', (e) => {
      if (e.cancelable) e.preventDefault();
      this.used = true;
      if (this.lookId !== null) return;
      const t = e.changedTouches[0];
      this.lookId = t.identifier;
      this.lastX = t.clientX;
      this.lastY = t.clientY;
    }, opts);
    lookZone.addEventListener('touchmove', (e) => {
      if (e.cancelable) e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== this.lookId) continue;
        this.dx += t.clientX - this.lastX;
        this.dy += t.clientY - this.lastY;
        this.lastX = t.clientX;
        this.lastY = t.clientY;
      }
    }, opts);
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) if (t.identifier === this.lookId) this.lookId = null;
    };
    lookZone.addEventListener('touchend', end);
    lookZone.addEventListener('touchcancel', end);

    btnCrouch.addEventListener('touchstart', (e) => {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      this.crouch = true;
      this.used = true;
    }, opts);

    // Evita zoom y menús del navegador mientras se juega.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  reset() {
    this.mx = this.mz = this.dx = this.dy = 0;
    this.lookId = null;
  }

  move() { return { x: this.mx, z: this.mz }; }

  consumeLook(_dt: number, sens: number) {
    const out = { yaw: this.dx * 0.0052 * sens, pitch: this.dy * 0.0042 * sens };
    this.dx = this.dy = 0;
    return out;
  }

  consumeCrouch() { const v = this.crouch; this.crouch = false; return v; }
  consumePause() { return false; }
}
