import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { Game } from './core/Game';

// La aplicación busca versiones nuevas al abrirse, cada minuto y cada vez que vuelves a ella (en el iPhone una app abierta no se recarga sola);
// cuando hay una nueva, se recarga sola en cuanto está descargada.
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return;
    const check = () => { reg.update().catch(() => undefined); };
    setInterval(check, 60_000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  },
});
const buildEl = document.getElementById('build');
if (buildEl) buildEl.textContent = 'Versión ' + __BUILD__;

const game = new Game(document.getElementById('game') as HTMLCanvasElement);
(window as unknown as { __game: Game }).__game = game;
game.init().catch((err) => {
  console.error(err);
  document.getElementById('loading')!.textContent = 'No se ha podido iniciar el juego: ' + (err?.message ?? err);
});
