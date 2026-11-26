import type { EnemyManager } from '../enemies/EnemyManager';
import type { BrainParams } from '../enemies/DroidBrain';
import type { EnemyKind } from '../sim/types';
import { SIZE_CHANGE } from '../enemies/sizes';
import { currentZone } from '../world/zone';
import { ARENA_ROUND, DOORS, ENEMY_DOORS, type Door } from '../world/arena/layout';

/** En la arena, de vez en cuando una oleada entra solo por una o dos puertas (nunca dos seguidas ni la primera de la arena). */
const SURPRISE_CHANCE = 0.25;
const DOOR_NAMES: Record<string, string> = { norte: 'norte', este: 'este', oeste: 'oeste' };

export type WavePhase = 'idle' | 'intro' | 'fighting' | 'clear';

const RUSH_AFTER = 40; // segundos sin ninguna baja antes de que los últimos droides ataquen sin esperar
const INTRO_TIME = 3.2;
const CLEAR_TIME = 4.5;

// Ronda en la que aparece por primera vez cada tipo de droide
export const B2_FROM = 4;
export const DROIDEKA_FROM = 7;

/** Qué enemigos trae cada ronda: B1 siempre; B2 desde la ronda 4; droidekas desde la 7. */
export function composition(round: number) {
  const b2 = round >= B2_FROM ? Math.floor((round - 2) / 2) : 0; // r4: 1, r6: 2, r8: 3…
  const droideka = round >= DROIDEKA_FROM ? Math.floor((round - 5) / 2) : 0; // r7: 1, r9: 2…
  const b1 = Math.max(4, 3 + 2 * round - 2 * b2 - 3 * droideka);
  return { b1, b2, droideka };
}

// Máximo de pesados vivos a la vez
const MAX_B2 = 2;
const MAX_DROIDEKA = 2;

/** Parte de los droides que llega por detrás (empieza poco y sube hasta la mitad). */
function rearShare(round: number) {
  return Math.min(0.5, 0.25 + 0.04 * (round - 1));
}

/** Cuántos pueden estar vivos a la vez. */
function maxAlive(round: number) {
  return Math.min(12, 3 + round);
}

/** Droide B2: lento, resistente y con disparos más fuertes. */
export function b2Params(round: number): BrainParams {
  const r = round - 1;
  return {
    speed: Math.min(3.1, 2.5 + 0.05 * r),
    damage: Math.min(20, 12 + 0.5 * r),
    spread: (3.4 * Math.PI) / 180,
    cooldown: [1.4, 2.6],
    burst: [1, 2],
    interval: 0.34,
    coverTime: [1.0, 2.0],
    sfx: 'b2' as const,
    // dispara desde la mano derecha, con el antebrazo extendido hacia delante (medidas que siguen al tamaño del modelo)
    muzzleY: 1.36 * SIZE_CHANGE.b2,
    muzzleFwd: 1.0 * SIZE_CHANGE.b2,
    muzzleSide: 0.47 * SIZE_CHANGE.b2,
  };
}

/** Droideka: rueda muy rápido, se despliega al llegar y dispara ráfagas largas bajo su escudo. */
export function droidekaParams(round: number): BrainParams {
  const r = round - 1;
  return {
    speed: 8.5,
    damage: Math.min(10, 6 + 0.3 * r),
    spread: (3.6 * Math.PI) / 180,
    cooldown: [0.5, 1.1],
    burst: [5, 8],
    interval: 0.1,
    coverTime: [3, 5],
    deployTime: 0.8,
    sfx: 'droideka' as const,
    muzzleY: 0.75 * SIZE_CHANGE.droideka, // los cañones del modelo real, más bajos y adelantados que los del de formas sencillas
    muzzleFwd: 1.25 * SIZE_CHANGE.droideka,
    muzzleSide: 0.52 * SIZE_CHANGE.droideka, // salen de las manos y se alternan: un disparo por cada mano
    muzzleAlt: true,
  };
}

/** Dificultad de los B1 según la ronda: poco a poco más rápidos, más certeros y más agresivos. */
export function b1Params(round: number): BrainParams {
  const r = round - 1;
  return {
    speed: Math.min(4.6, 3.6 + 0.08 * r),
    damage: Math.min(12, 6 + 0.35 * r),
    spread: ((4.2 - Math.min(2, 0.1 * r)) * Math.PI) / 180,
    cooldown: [Math.max(0.8, 2.1 - 0.06 * r), Math.max(1.4, 3.4 - 0.1 * r)],
    burst: [2, 3],
    sfx: 'b1' as const,
    muzzleY: 1.15 * SIZE_CHANGE.b1, // el rifle va a la altura del pecho, algo adelantado
    muzzleFwd: 0.65 * SIZE_CHANGE.b1,
  };
}

export interface WaveEvents {
  onBanner: (title: string, sub: string, seconds: number) => void;
  onRoundCleared: (round: number) => void;
  /** Se ha completado la última ronda del cañón: hay que pasar a la arena y luego llamar a start(round). */
  onEnterArena?: (round: number) => void;
}

// Controla las rondas: aviso, aparición escalonada de droides y fin de ronda.
export class WaveManager {
  round = 0;
  phase: WavePhase = 'idle';
  private timer = 0;
  private queue: EnemyKind[] = [];
  private spawnTimer = 0;
  private sinceKill = 0;
  private prevRemaining = 0;
  /** Puertas por las que entran los droides en esta oleada (arena). */
  private doors: Door[] = [];
  private lastSurprise = false;
  private doorTurn = 0;

  constructor(
    private enemies: EnemyManager,
    private ev: WaveEvents,
  ) {}

  /** Droides que quedan por destruir en esta ronda. */
  get remaining() {
    return this.queue.length + this.enemies.aliveCount();
  }

  start(round: number) {
    this.round = round;
    this.lastSurprise = false;
    this.doorTurn = 0;
    this.beginIntro();
  }

  stop() {
    this.phase = 'idle';
    this.queue = [];
    this.enemies.context.rush = false;
  }

  private beginIntro() {
    this.phase = 'intro';
    this.timer = INTRO_TIME;
    this.sinceKill = 0;
    this.enemies.context.rush = false;
    this.queue = this.buildQueue(this.round);
    this.prevRemaining = this.queue.length;
    this.spawnTimer = 0;
    let sub =
      this.round === B2_FROM ? '¡Llegan los droides B2! Resisten más disparos'
      : this.round === DROIDEKA_FROM ? '¡Llegan los droidekas! Escudos: usa las granadas'
      : this.round === 1 ? 'Vienen por los dos extremos del cañón'
      : '¡Vigila tu espalda!';
    if (currentZone() === 'arena') { const doors = this.pickDoors(); if (doors && this.round !== DROIDEKA_FROM) sub = doors; } // en la 7 (primera de la arena) manda el aviso de los droidekas
    this.ev.onBanner(`RONDA ${this.round}`, sub, INTRO_TIME);
  }

  /**
   * ARENA: elige por qué puertas entra esta oleada. Normalmente por las tres (norte, este y oeste); a veces, por sorpresa,
   * solo por una o dos. Devuelve el aviso que se enseña (o null si no hay nada especial que avisar).
   */
  private pickDoors(): string | null {
    const all = DOORS.filter((d) => (ENEMY_DOORS as readonly string[]).includes(d.name));
    const first = this.round === ARENA_ROUND;
    const surprise = !first && !this.lastSurprise && Math.random() < SURPRISE_CHANCE;
    this.lastSurprise = surprise;
    if (!surprise) {
      this.doors = all;
      return first ? 'Entran por las puertas norte, este y oeste' : null;
    }
    const shuffled = [...all].sort(() => Math.random() - 0.5);
    this.doors = shuffled.slice(0, Math.random() < 0.5 ? 1 : 2);
    const names = this.doors.map((d) => DOOR_NAMES[d.name]);
    return names.length === 1 ? `¡Atención! Todos entran por la puerta ${names[0]}` : `¡Atención! Entran por las puertas ${names[0]} y ${names[1]}`;
  }

  /** Lista de droides de la ronda, mezclados; los pesados nunca salen los primeros. */
  private buildQueue(round: number): EnemyKind[] {
    const c = composition(round);
    const q: EnemyKind[] = [...Array<EnemyKind>(c.b1).fill('b1'), ...Array<EnemyKind>(c.b2).fill('b2'), ...Array<EnemyKind>(c.droideka).fill('droideka')];
    for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
    // Los dos primeros son B1 para empezar con calma
    for (let i = 0; i < Math.min(2, q.length); i++) {
      if (q[i] !== 'b1') { const j = q.findIndex((k, idx) => idx >= 2 && k === 'b1'); if (j >= 0) [q[i], q[j]] = [q[j], q[i]]; }
    }
    return q;
  }

  /** Siguiente droide que se puede sacar ahora (respetando el máximo de pesados vivos). */
  private nextKind(): number {
    for (let i = 0; i < this.queue.length; i++) {
      const k = this.queue[i];
      if (k === 'b2' && this.enemies.aliveCount('b2') >= MAX_B2) continue;
      if (k === 'droideka' && this.enemies.aliveCount('droideka') >= MAX_DROIDEKA) continue;
      return i;
    }
    return -1;
  }

  update(dt: number) {
    if (this.phase === 'idle') return;
    this.timer -= dt;

    if (this.phase === 'intro') {
      if (this.timer <= 0) this.phase = 'fighting';
      return;
    }

    if (this.phase === 'fighting') {
      // Si la ronda se alarga y quedan pocos, los que quedan atacan sin esperar.
      const rem = this.remaining;
      if (rem < this.prevRemaining) this.sinceKill = 0; else this.sinceKill += dt;
      this.prevRemaining = rem;
      this.enemies.context.rush = this.queue.length === 0 && rem <= 3 && this.sinceKill > RUSH_AFTER;
      this.spawnTimer -= dt;
      if (this.queue.length > 0 && this.spawnTimer <= 0 && this.enemies.aliveCount() < maxAlive(this.round)) {
        const i = this.nextKind();
        if (i >= 0) {
          const kind = this.queue[i];
          const params = kind === 'b2' ? b2Params(this.round) : kind === 'droideka' ? droidekaParams(this.round) : b1Params(this.round);
          if (currentZone() === 'arena') {
            // por turnos entre las puertas de esta oleada; si en una no se puede (estás tú en el túnel), prueba la siguiente
            for (let k = 0; k < this.doors.length; k++) {
              const door = this.doors[(this.doorTurn + k) % this.doors.length];
              if (this.enemies.spawnAtDoor(kind, params, door)) { this.queue.splice(i, 1); this.doorTurn = (this.doorTurn + k + 1) % this.doors.length; break; }
            }
          } else if (this.enemies.spawn(kind, params, Math.random() < rearShare(this.round), this.round)) this.queue.splice(i, 1);
        }
        this.spawnTimer = Math.max(0.7, 1.6 - 0.05 * this.round);
      }
      if (this.queue.length === 0 && this.enemies.aliveCount() === 0) {
        // última ronda del cañón: al caer el último droide se pasa a la arena en el acto (empieza la cinemática de paso, sin esperar)
        if (this.round + 1 >= ARENA_ROUND && currentZone() === 'canyon' && this.ev.onEnterArena) {
          this.enemies.context.rush = false;
          this.ev.onRoundCleared(this.round);
          this.round++;
          this.phase = 'idle';
          this.ev.onEnterArena(this.round);
          return;
        }
        this.phase = 'clear';
        this.enemies.context.rush = false;
        this.timer = CLEAR_TIME;
        this.ev.onBanner('RONDA SUPERADA', 'Recuperas algo de vida', CLEAR_TIME);
        this.ev.onRoundCleared(this.round);
      }
      return;
    }

    if (this.phase === 'clear' && this.timer <= 0) {
      this.round++;
      // última ronda del cañón superada: se pasa a la arena (el juego hace el fundido y vuelve a llamar a start)
      if (this.round >= ARENA_ROUND && currentZone() === 'canyon' && this.ev.onEnterArena) {
        this.phase = 'idle';
        this.ev.onEnterArena(this.round);
        return;
      }
      this.beginIntro();
    }
  }
}
