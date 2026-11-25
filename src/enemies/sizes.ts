import type { EnemyKind } from '../sim/types';

// TAMAÑO DE LOS DROIDES. Altura real de cada uno, de los pies a lo alto de la cabeza (la pidió Víctor):
//   B1 1,93 m · B2 1,93 m · droideka 1,83 m desplegado y de pie (en modo bola, en proporción a su modelo).
// Los modelos se escalan para medir eso; el cuerpo sólido, el punto al que se apunta y de dónde salen sus disparos se escalan igual.
export const DROID_HEIGHT: Record<EnemyKind, number> = { b1: 1.93, b2: 1.93, droideka: 1.83 };

/** Lo que mide cada modelo tal cual se carga, sin escalar (medido en el juego: B1 y B2 de pie; droideka desplegado). */
const MODEL_HEIGHT: Record<EnemyKind, number> = { b1: 1.953, b2: 2.35, droideka: 1.827 };

/** Escala que se aplica a cada modelo. */
export const DROID_SCALE: Record<EnemyKind, number> = {
  b1: DROID_HEIGHT.b1 / MODEL_HEIGHT.b1,
  b2: DROID_HEIGHT.b2 / MODEL_HEIGHT.b2,
  droideka: DROID_HEIGHT.droideka / MODEL_HEIGHT.droideka,
};

/**
 * Cuánto cambia cada droide respecto al tamaño con el que se ajustaron sus medidas de cuerpo y disparos
 * (B1 y B2 a su tamaño de modelo; el droideka al 95 %).
 */
export const SIZE_CHANGE: Record<EnemyKind, number> = { b1: DROID_SCALE.b1, b2: DROID_SCALE.b2, droideka: DROID_SCALE.droideka / 0.95 };
