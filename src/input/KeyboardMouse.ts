import type { InputSource } from './types';

// Teclado y ratón (para probar en el ordenador).
export class KeyboardMouse implements InputSource {
  private keys = new Set<string>();
  private dx = 0;
  private dy = 0;
  private crouch = false;
  private jump = false;
  private pause = false;
  private lockedAt = 0;
  private mouseDown = false;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyC' || e.code === 'ShiftLeft') this.crouch = true;
      if (e.code === 'Space') { this.jump = true; e.preventDefault(); }
      if (e.code === 'KeyP' || e.code === 'Escape') this.pause = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; });
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0 && document.pointerLockElement === canvas) this.mouseDown = true; });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; });
    document.addEventListener('pointerlockchange', () => (this.lockedAt = performance.now()));
    document.addEventListener('mousemove', (e) => {
      // Se ignora el primer instante tras capturar el ratón (suele llegar un salto brusco).
      if (document.pointerLockElement === this.canvas && performance.now() - this.lockedAt > 200) {
        this.dx += e.movementX;
        this.dy += e.movementY;
      }
    });
  }

  private k(...codes: string[]) {
    return codes.some((c) => this.keys.has(c)) ? 1 : 0;
  }

  move() {
    return { x: this.k('KeyD') - this.k('KeyA'), z: this.k('KeyW') - this.k('KeyS') };
  }

  consumeLook(dt: number, sens: number) {
    // Ratón + flechas del teclado como alternativa.
    const ax = this.k('ArrowRight') - this.k('ArrowLeft');
    const ay = this.k('ArrowDown') - this.k('ArrowUp');
    const out = {
      yaw: this.dx * 0.0022 * sens + ax * 2 * dt * sens,
      pitch: this.dy * 0.0022 * sens + ay * 1.4 * dt * sens,
    };
    this.dx = this.dy = 0;
    return out;
  }

  fire() { return this.mouseDown || this.keys.has('KeyF'); }
  consumeCrouch() { const v = this.crouch; this.crouch = false; return v; }
  consumeJump() { const v = this.jump; this.jump = false; return v; }
  consumePause() { const v = this.pause; this.pause = false; return v; }
}
