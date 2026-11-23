const $ = (id: string) => document.getElementById(id)!;

// Pantalla de fin de partida.
export class GameOver {
  private root = $('gameover');

  constructor(onRetry: () => void, onMenu: () => void) {
    $('btnRetry').addEventListener('click', onRetry);
    $('btnToMenu').addEventListener('click', onMenu);
  }

  show(round: number, kills: number, best: number, record: boolean, testMode: boolean) {
    $('goRound').textContent = String(round);
    $('goKills').textContent = String(kills);
    $('goBest').textContent = testMode
      ? 'Partida de pruebas: no cuenta para el récord.'
      : record
        ? '¡Nuevo récord!'
        : `Mejor ronda: ${best}`;
    this.root.hidden = false;
  }

  hide() {
    this.root.hidden = true;
  }
}
