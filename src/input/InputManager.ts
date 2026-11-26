import { GamepadInput } from './Gamepad';
import { KeyboardMouse } from './KeyboardMouse';
import { Touch } from './Touch';

export interface FrameInput {
  moveX: number;
  moveZ: number;
  yaw: number;
  pitch: number;
  fire: boolean; // disparo principal (apuntado)
  fireHip: boolean; // disparo desde la cadera
  aimHeld: boolean; // mantener para apuntar
  aimToggled: boolean; // se ha pulsado el botón de apuntar
  /** true si la vista se está moviendo con controles táctiles (para la ayuda al apuntar) */
  touchAim: boolean;
  crouchPressed: boolean;
  jumpPressed: boolean;
  grenadePressed: boolean;
  /** botón de granada mantenido (se sujeta mientras se mantiene, se lanza al soltar) */
  grenadeHeld: boolean;
  pausePressed: boolean;
}

// Reúne táctil, mando y teclado en una sola "orden" para el juego.
export class InputManager {
  readonly keyboard: KeyboardMouse;
  readonly gamepad = new GamepadInput();
  readonly touch: Touch | null = null;
  gamepadActive = false;

  constructor(canvas: HTMLCanvasElement, touchRoot: HTMLElement) {
    this.keyboard = new KeyboardMouse(canvas);
    if (Touch.available()) {
      this.touch = new Touch(touchRoot);
      document.body.classList.add('touch');
    }
  }

  get hasTouch() { return this.touch !== null; }

  poll(dt: number, sensitivity: number): FrameInput {
    // Si hay mando, se usa automáticamente y se esconden los botones táctiles.
    const pad = this.gamepad.poll();
    if (pad !== this.gamepadActive) {
      this.gamepadActive = pad;
      document.body.classList.toggle('gamepad', pad);
      this.touch?.reset();
    }

    const out: FrameInput = { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, fire: false, fireHip: false, aimHeld: false, aimToggled: false, touchAim: false, crouchPressed: false, jumpPressed: false, grenadePressed: false, grenadeHeld: false, pausePressed: false };
    const sources = [this.keyboard, this.gamepad, ...(this.touch && !pad ? [this.touch] : [])];
    for (const s of sources) {
      const m = s.move();
      out.moveX += m.x;
      out.moveZ += m.z;
      const l = s.consumeLook(dt, sensitivity);
      out.yaw += l.yaw;
      out.pitch += l.pitch;
      out.fire = s.fire() || out.fire;
      out.fireHip = s.fireHip() || out.fireHip;
      out.aimHeld = s.aimHeld() || out.aimHeld;
      out.aimToggled = s.consumeAimToggle() || out.aimToggled;
      if (s === this.touch && (l.yaw !== 0 || l.pitch !== 0 || s.fire() || s.fireHip())) out.touchAim = true;
      out.crouchPressed = s.consumeCrouch() || out.crouchPressed;
      out.jumpPressed = s.consumeJump() || out.jumpPressed;
      out.grenadePressed = s.consumeGrenade() || out.grenadePressed;
      out.grenadeHeld = s.grenadeHeld() || out.grenadeHeld;
      out.pausePressed = s.consumePause() || out.pausePressed;
    }
    out.moveX = Math.max(-1, Math.min(1, out.moveX));
    out.moveZ = Math.max(-1, Math.min(1, out.moveZ));
    return out;
  }
}
