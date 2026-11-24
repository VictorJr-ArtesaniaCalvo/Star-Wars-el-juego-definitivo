import type { EnemyManager } from '../enemies/EnemyManager';
import type { BrainParams } from '../enemies/DroidBrain';

export type WavePhase = 'idle' | 'intro' | 'fighting' | 'clear';

const INTRO_TIME = 3.2;
const CLEAR_TIME = 4.5;

/** Qué enemigos trae cada ronda. En la Fase 5 se añadirán aquí los B2 y los droidekas. */
export function composition(round: number) {
  return { b1: 3 + 2 * round };
}

/** Parte de los droides que llega por detrás (empieza poco y sube hasta la mitad). */
function rearShare(round: number) {
  return Math.min(0.5, 0.25 + 0.04 * (round - 1));
}

/** Cuántos pueden estar vivos a la vez. */
function maxAlive(round: number) {
  return Math.min(12, 3 + round);
}

/** Dificultad de los B1 según la ronda: poco a poco más rápidos, más certeros y más agresivos. */
export function b1Params(round: number): BrainParams {
  const r = round - 1;
  return {
    speed: Math.min(3.3, 2.4 + 0.07 * r),
    damage: Math.min(12, 6 + 0.35 * r),
    spread: ((4.2 - Math.min(2, 0.1 * r)) * Math.PI) / 180,
    cooldown: [Math.max(0.8, 2.1 - 0.06 * r), Math.max(1.4, 3.4 - 0.1 * r)],
    burst: [2, 3],
  };
}

export interface WaveEvents {
  onBanner: (title: string, sub: string, seconds: number) => void;
  onRoundCleared: (round: number) => void;
}

// Controla las rondas: aviso, aparición escalonada de droides y fin de ronda.
export class WaveManager {
  round = 0;
  phase: WavePhase = 'idle';
  private timer = 0;
  private queue = 0;
  private spawnTimer = 0;

  constructor(
    private enemies: EnemyManager,
    private ev: WaveEvents,
  ) {}

  /** Droides que quedan por destruir en esta ronda. */
  get remaining() {
    return this.queue + this.enemies.aliveCount();
  }

  start(round: number) {
    this.round = round;
    this.beginIntro();
  }

  stop() {
    this.phase = 'idle';
    this.queue = 0;
  }

  private beginIntro() {
    this.phase = 'intro';
    this.timer = INTRO_TIME;
    this.queue = composition(this.round).b1;
    this.spawnTimer = 0;
    this.ev.onBanner(`RONDA ${this.round}`, this.round === 1 ? 'Vienen por los dos extremos del cañón' : '¡Vigila tu espalda!', INTRO_TIME);
  }

  update(dt: number) {
    if (this.phase === 'idle') return;
    this.timer -= dt;

    if (this.phase === 'intro') {
      if (this.timer <= 0) this.phase = 'fighting';
      return;
    }

    if (this.phase === 'fighting') {
      this.spawnTimer -= dt;
      if (this.queue > 0 && this.spawnTimer <= 0 && this.enemies.aliveCount() < maxAlive(this.round)) {
        if (this.enemies.spawn(b1Params(this.round), Math.random() < rearShare(this.round))) this.queue--;
        this.spawnTimer = Math.max(0.7, 1.6 - 0.05 * this.round);
      }
      if (this.queue === 0 && this.enemies.aliveCount() === 0) {
        this.phase = 'clear';
        this.timer = CLEAR_TIME;
        this.ev.onBanner('RONDA SUPERADA', 'Recuperas algo de vida', CLEAR_TIME);
        this.ev.onRoundCleared(this.round);
      }
      return;
    }

    if (this.phase === 'clear' && this.timer <= 0) {
      this.round++;
      this.beginIntro();
    }
  }
}
