// Indicadores en pantalla: punto de mira, postura, calor del bláster y botón de pausa.
// Vida, granadas y ronda se añadirán en sus fases.
export class Hud {
  private root = document.getElementById('hud')!;
  private touch = document.getElementById('touch')!;
  private stance = document.getElementById('stance')!;
  private btnCrouch = document.getElementById('btnCrouch')!;
  private crouching: boolean | null = null;
  private heat = document.getElementById('heat')!;
  private heatFill = document.getElementById('heatFill')!;
  private heatLabel = document.getElementById('heatLabel')!;
  private hitmark = document.getElementById('hitmark')!;
  private hitLife = 0;
  private lastHeat = -1;
  private lastLocked: boolean | null = null;

  constructor(onPause: () => void) {
    document.getElementById('btnPause')!.addEventListener('click', onPause);
  }

  setVisible(v: boolean, touch: boolean) {
    this.root.hidden = !v;
    this.touch.hidden = !(v && touch);
  }

  setHeat(heat: number, locked: boolean) {
    const pct = Math.round(heat * 100);
    if (pct !== this.lastHeat) {
      this.lastHeat = pct;
      this.heatFill.style.width = pct + '%';
      // De azul (frío) a naranja y rojo (caliente).
      this.heatFill.style.background = locked ? '#ff3a20' : heat < 0.5 ? '#66b8ff' : heat < 0.8 ? '#ffb040' : '#ff6a30';
    }
    if (locked !== this.lastLocked) {
      this.lastLocked = locked;
      this.heat.classList.toggle('locked', locked);
      this.heatLabel.textContent = locked ? 'SOBRECALENTADO' : 'BLÁSTER';
    }
  }

  /** Marca en la mira al acertar a un enemigo. */
  hit(kill: boolean) {
    this.hitLife = 1;
    this.hitmark.classList.toggle('kill', kill);
  }

  update(dt: number) {
    if (this.hitLife <= 0) return;
    this.hitLife = Math.max(0, this.hitLife - dt * 4);
    this.hitmark.style.opacity = String(this.hitLife);
  }

  setCrouching(c: boolean) {
    if (c === this.crouching) return;
    this.crouching = c;
    this.stance.textContent = c ? 'AGACHADO' : 'DE PIE';
    this.stance.classList.toggle('crouch', c);
    this.btnCrouch.classList.toggle('on', c);
  }
}
