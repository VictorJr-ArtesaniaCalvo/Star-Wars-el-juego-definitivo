import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { Game } from './core/Game';

registerSW({ immediate: true });

const game = new Game(document.getElementById('game') as HTMLCanvasElement);
(window as unknown as { __game: Game }).__game = game;
game.init().catch((err) => {
  console.error(err);
  document.getElementById('loading')!.textContent = 'No se ha podido iniciar el juego: ' + (err?.message ?? err);
});
