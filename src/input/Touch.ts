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
  private mainId: number | null = null;
  private hipId: number | null = null;
  private aimToggle = false;
  private lastX = 0;
  private lastY = 0;
  private crouch = false;
  private jump = false;
  private firing = false;
  private firingHip = false;
  /** true cuando se ha tocado la pantalla hace poco (para saber qué control se está usando) */
  used = false;

  constructor(root: HTMLElement) {
    const joyZone = root.querySelector<HTMLElement>('#joyZone')!;
    const lookZone = root.querySelector<HTMLElement>('#lookZone')!;
    const btnCrouch = root.querySelector<HTMLElement>('#btnCrouch')!;
    const btnFire = root.querySelector<HTMLElement>('#btnFire')!;
    const btnJump = root.querySelector<HTMLElement>('#btnJump')!;
    const btnHip = root.querySelector<HTMLElement>('#btnHip')!;
    const btnAim = root.querySelector<HTMLElement>('#btnAim')!;

    const joy = nipplejs.create({
      zone: joyZone,
      mode: 'dynamic',
      size: 130,
      color: 'rgba(255,255,255,0.32)',
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
    // Los botones de disparo también sirven para mover la mira: se puede disparar y deslizar con el mismo dedo.
    const startLook = (kind: 'none' | 'main' | 'hip') => (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      this.used = true;
      const t = e.changedTouches[0];
      if (kind === 'main') { this.firing = true; this.mainId = t.identifier; btnFire.classList.add('on'); }
      if (kind === 'hip') { this.firingHip = true; this.hipId = t.identifier; btnHip.classList.add('on'); }
      if (this.lookId !== null) return;
      this.lookId = t.identifier;
      this.lastX = t.clientX;
      this.lastY = t.clientY;
    };
    lookZone.addEventListener('touchstart', startLook('none'), opts);
    btnFire.addEventListener('touchstart', startLook('main'), opts);
    btnHip.addEventListener('touchstart', startLook('hip'), opts);
    const move = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== this.lookId) continue;
        this.dx += t.clientX - this.lastX;
        this.dy += t.clientY - this.lastY;
        this.lastX = t.clientX;
        this.lastY = t.clientY;
      }
    };
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.lookId) this.lookId = null;
        if (t.identifier === this.mainId) { this.mainId = null; this.firing = false; btnFire.classList.remove('on'); }
        if (t.identifier === this.hipId) { this.hipId = null; this.firingHip = false; btnHip.classList.remove('on'); }
      }
    };
    for (const el of [lookZone, btnFire, btnHip]) {
      el.addEventListener('touchmove', move, opts);
      el.addEventListener('touchend', end);
      el.addEventListener('touchcancel', end);
    }

    btnAim.addEventListener('touchstart', (e) => {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      this.aimToggle = true;
      this.used = true;
    }, opts);

    btnCrouch.addEventListener('touchstart', (e) => {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      this.crouch = true;
      this.used = true;
    }, opts);

    btnJump.addEventListener('touchstart', (e) => {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      this.jump = true;
      this.used = true;
    }, opts);

    // Evita zoom y menús del navegador mientras se juega.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  reset() {
    this.mx = this.mz = this.dx = this.dy = 0;
    this.lookId = this.mainId = this.hipId = null;
    this.firing = this.firingHip = false;
    document.getElementById('btnFire')?.classList.remove('on');
    document.getElementById('btnHip')?.classList.remove('on');
  }

  move() { return { x: this.mx, z: this.mz }; }

  consumeLook(_dt: number, sens: number) {
    const out = { yaw: this.dx * 0.0052 * sens, pitch: this.dy * 0.0042 * sens };
    this.dx = this.dy = 0;
    return out;
  }

  fire() { return this.firing; }
  fireHip() { return this.firingHip; }
  aimHeld() { return false; }
  consumeAimToggle() { const v = this.aimToggle; this.aimToggle = false; return v; }
  consumeCrouch() { const v = this.crouch; this.crouch = false; return v; }
  consumeJump() { const v = this.jump; this.jump = false; return v; }
  consumePause() { return false; }
}
