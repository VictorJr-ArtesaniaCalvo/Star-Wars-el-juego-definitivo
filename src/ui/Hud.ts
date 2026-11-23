// Indicadores en pantalla. En esta fase: punto de mira, postura y botón de pausa.
// Vida, calor del bláster, granadas y ronda se añadirán en sus fases.
export class Hud {
  private root = document.getElementById('hud')!;
  private touch = document.getElementById('touch')!;
  private stance = document.getElementById('stance')!;
  private btnCrouch = document.getElementById('btnCrouch')!;
  private crouching: boolean | null = null;

  constructor(onPause: () => void) {
    document.getElementById('btnPause')!.addEventListener('click', onPause);
  }

  setVisible(v: boolean, touch: boolean) {
    this.root.hidden = !v;
    this.touch.hidden = !(v && touch);
  }

  setCrouching(c: boolean) {
    if (c === this.crouching) return;
    this.crouching = c;
    this.stance.textContent = c ? 'AGACHADO' : 'DE PIE';
    this.stance.classList.toggle('crouch', c);
    this.btnCrouch.classList.toggle('on', c);
  }
}
