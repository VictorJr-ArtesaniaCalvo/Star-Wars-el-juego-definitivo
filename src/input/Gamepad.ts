import type { InputSource } from './types';

const DEADZONE = 0.14;
const axis = (v: number) => {
  const a = Math.abs(v);
  if (a < DEADZONE) return 0;
  return Math.sign(v) * ((a - DEADZONE) / (1 - DEADZONE));
};

// Mando Bluetooth (PlayStation / Xbox). Distribución estándar:
// stick izquierdo mover, stick derecho mirar, gatillo derecho (RT/R2) disparar apuntando, RB/R1 disparar desde la cadera,
// gatillo izquierdo (LT/L2) apuntar, A/Cruz saltar,
// B/Círculo o pulsar stick derecho agacharse, Options/Menu pausa.
export class GamepadInput implements InputSource {
  private prev: boolean[] = [];
  private crouch = false;
  private jump = false;
  private pause = false;
  private pad: Gamepad | null = null;

  /** Hay que llamarlo una vez por fotograma. Devuelve true si hay un mando conectado. */
  poll(): boolean {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pad = null;
    for (const p of pads) if (p && p.connected && p.axes.length >= 4) { this.pad = p; break; }
    if (!this.pad) { this.prev = []; return false; }
    const b = this.pad.buttons.map((x) => x.pressed);
    const pressed = (i: number) => !!b[i] && !this.prev[i];
    if (pressed(1) || pressed(11)) this.crouch = true;
    if (pressed(0)) this.jump = true;
    if (pressed(9)) this.pause = true;
    this.prev = b;
    return true;
  }

  move() {
    if (!this.pad) return { x: 0, z: 0 };
    return { x: axis(this.pad.axes[0]), z: -axis(this.pad.axes[1]) };
  }

  consumeLook(dt: number, sens: number) {
    if (!this.pad) return { yaw: 0, pitch: 0 };
    const x = axis(this.pad.axes[2]), y = axis(this.pad.axes[3]);
    // Respuesta progresiva: fino cerca del centro, rápido al fondo.
    return { yaw: x * Math.abs(x) * 3.0 * dt * sens, pitch: y * Math.abs(y) * 2.0 * dt * sens };
  }

  // RT/R2: disparo apuntado · RB/R1: disparo desde la cadera · LT/L2: mantener para apuntar
  fire() {
    const b = this.pad?.buttons;
    return !!b && (!!b[7]?.pressed || (b[7]?.value ?? 0) > 0.3);
  }
  fireHip() {
    const b = this.pad?.buttons;
    return !!b && !!b[5]?.pressed;
  }
  aimHeld() {
    const b = this.pad?.buttons;
    return !!b && (!!b[6]?.pressed || (b[6]?.value ?? 0) > 0.3);
  }
  consumeAimToggle() { return false; }
  consumeCrouch() { const v = this.crouch; this.crouch = false; return v; }
  consumeJump() { const v = this.jump; this.jump = false; return v; }
  consumePause() { const v = this.pause; this.pause = false; return v; }
}
