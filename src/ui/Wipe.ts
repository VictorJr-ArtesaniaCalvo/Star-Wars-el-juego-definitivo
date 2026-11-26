// CORTINILLA AL ESTILO STAR WARS: al pulsar JUGAR, una cortina negra barre la pantalla de derecha a izquierda,
// con la punta un poco difuminada (no es un corte seco). Cuando la pantalla queda en negro, empieza la partida
// (la cinemática ya arranca en negro) y la cortina se quita con un fundido corto.

/** Lo que tarda la cortina en cruzar la pantalla (segundos). */
export const WIPE_TIME = 1.1;
/** Lo que tarda en quitarse la cortina negra cuando ya ha empezado la partida (segundos). */
const REVEAL_TIME = 0.5;

export class Wipe {
  private el = document.getElementById('wipe') as HTMLDivElement;
  private running = false;

  get busy() { return this.running; }

  /** Barre la pantalla a negro y luego llama a `covered` (con la pantalla ya en negro). */
  run(covered: () => void) {
    if (this.running) return;
    this.running = true;
    const el = this.el;
    el.hidden = false;
    el.classList.remove('done', 'reveal');
    el.style.setProperty('--wipe-time', `${WIPE_TIME}s`);
    void el.offsetWidth; // que arranque desde fuera de la pantalla
    el.classList.add('sweep');
    window.setTimeout(() => {
      el.classList.add('done'); // negro del todo
      covered();
      // dos fotogramas para que la partida (o la cinemática) ya esté dibujada debajo
      requestAnimationFrame(() => requestAnimationFrame(() => this.reveal()));
    }, WIPE_TIME * 1000 + 60);
  }

  private reveal() {
    const el = this.el;
    el.style.setProperty('--reveal-time', `${REVEAL_TIME}s`);
    el.classList.add('reveal');
    window.setTimeout(() => {
      el.hidden = true;
      el.classList.remove('sweep', 'done', 'reveal');
      this.running = false;
    }, REVEAL_TIME * 1000 + 60);
  }
}
