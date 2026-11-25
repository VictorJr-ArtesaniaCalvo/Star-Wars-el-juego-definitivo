// ============================================================================
//  GUION DE LA CINEMÁTICA INICIAL
// ============================================================================
// Todo lo que se ve y se oye en la cinemática está aquí, toma a toma, para poder ajustarlo cambiando números.
//
// CÓMO LEER LAS POSICIONES
//  · Un punto es [x, altura, z] en metros.
//      x: izquierda (−) / derecha (+) mirando hacia el norte, por donde vienen los droides de delante.
//      z: norte (−, hacia delante) / sur (+, a tu espalda). La cañonera estrellada está en el centro (0, 0).
//      altura: metros SOBRE EL SUELO de ese punto (así la cámara no se mete bajo la arena aunque cambie el relieve).
//  · En la toma dentro de la cañonera en vuelo, los puntos de la cámara son DENTRO de la nave:
//      en metros reales: x hacia el morro, altura desde el centro del casco (el suelo de la bahía está en ‑3,35), z hacia el lado de la puerta abierta (−).
//  · `en`: segundos desde que empieza la toma.  · `angulo`: campo de visión en grados (menos = más zoom; el juego usa 72).
//  · `temblor`: 0 = cámara quieta · 0,3 = vuelo suave · 1 = mucho.
// ============================================================================

export type Punto = [number, number, number];
export interface Vista { pos: Punto; mira: Punto }

export type Camara =
  /** La cámara va de una vista a otra (con arranque y frenada suaves). */
  | { tipo: 'recorrido'; desde: Vista; hasta: Vista; suave?: boolean }
  /** La cámara gira alrededor de un punto. Ángulos en grados (0 = al este, 90 = al sur). */
  | { tipo: 'orbita'; centro: Punto; radio: number; altura: number; giroDesde: number; giroHasta: number; radioHasta?: number }
  /** La cámara va dentro de la cañonera en vuelo (posiciones dentro de la nave). */
  | { tipo: 'canonera'; desde: Vista; hasta: Vista };

export type Actor = 'canonera' | 'piernas' | 'comando' | 'droides';
export type Quien = 'SOLDADO' | 'COMANDANTE' | 'TÚ';

export interface Dialogo {
  en: number;
  quien: Quien;
  texto: string;
  /** Nombre del archivo de voz (public/audio/voces/<voz>.mp3). Si no existe, solo sale el subtítulo. */
  voz: string;
  /** 'radio' = comunicaciones entre naves (más sucia) · 'casco' = el protagonista dentro de su casco (más limpia). */
  filtro: 'radio' | 'casco';
  /** Segundos en pantalla si aún no hay archivo de voz (si no se pone, se calcula por la longitud del texto). */
  dura?: number;
}

export type Evento =
  | { en: number; tipo: 'disparosLejanos'; dura: number; cada?: number } // ráfagas lejanas de bláster durante `dura` s
  | { en: number; tipo: 'cañonazo'; fuerza?: number } // explosión lejana
  | { en: number; tipo: 'explosion'; donde: Punto; fuerza?: number } // estallido con chispas y fuego en un punto (sacude la cámara)
  | { en: number; tipo: 'sacudida'; fuerza: number }
  | { en: number; tipo: 'motor'; encender: boolean } // motor de la cañonera en vuelo
  | { en: number; tipo: 'fuego'; dura: number } // crepitar del fuego
  | { en: number; tipo: 'golpeCasco' } // nudillos contra el casco + estática
  | { en: number; tipo: 'estatica'; dura: number; filtro?: 'radio' | 'casco' };

/** Postura del comando: agachado (1 = del todo, 0 = de pie) · asoma (0..1) · golpe (0..1 = mano al casco). Entre dos posturas el cambio es suave. */
export interface Postura { en: number; agachado?: number; asoma?: number; golpe?: number }

export interface Toma {
  nombre: string;
  duracion: number;
  /** Pantalla en negro (no se dibuja el escenario). */
  negro?: boolean;
  /** Texto grande en el centro (con fundido). */
  titulo?: { texto: string; entra: number; sale: number };
  camara?: Camara;
  angulo?: number;
  temblor?: number;
  /** Neblina de la toma: empieza a `cerca` metros y lo tapa todo a `lejos`. Sin poner: la de siempre. */
  neblina?: { cerca: number; lejos: number };
  /** Fundido desde negro al empezar / a negro al acabar (segundos). */
  fundidoEntrada?: number;
  fundidoSalida?: number;
  actores?: Actor[];
  dialogos?: Dialogo[];
  eventos?: Evento[];
  posturas?: Postura[];
}

// ---------- Lugares fijos ----------
/** Donde está agachado el comando, en el borde del cráter junto al inicio. Al acabar la cinemática la partida empieza aquí, de pie y mirando al norte. */
export const COMANDO = { x: -4.35, z: 4.1 };
/** Caja de la República tras la que se cubre (es una cobertura de verdad del mapa, sólida también en la partida). `giro` en radianes. */
export const COBERTURA = { x: -4.3, z: 3.0, giro: 0.08 };

/** Vuelo de la cañonera durante la toma 2: gira alrededor de un punto con la puerta mirando hacia él. Ángulos de MAYOR a MENOR. */
export const VUELO = { centro: [0, -2] as [number, number], radio: 46, altura: 32, giroDesde: 60, giroHasta: 36, alabeo: 10 };

/** Dónde están de pie los dos clones junto a la puerta abierta (dentro de la nave, en metros; el suelo de la bahía está a ‑3,35). `separacion`: entre uno y otro. */
export const PIERNAS = { x: 0.35, suelo: -3.35, z: -1.3, separacion: 2.15 };

/** Estaturas (m). */
export const ESTATURA = { clon: 1.83, comando: 1.85 };

/** Droides B1 de la toma 4: dónde empiezan a andar (x, z). Avanzan hacia el sur (hacia la cámara). */
export const DROIDES: Array<[number, number]> = [[-3, -72], [1.5, -70], [5.5, -74], [-0.5, -77], [3.5, -79], [-6, -77.5], [8, -71]];

// ---------- Las tomas ----------
export const TOMAS: Toma[] = [
  {
    nombre: '1 · GEONOSIS',
    duracion: 3,
    negro: true,
    titulo: { texto: 'GEONOSIS', entra: 0.4, sale: 2.5 },
    eventos: [
      { en: 0.1, tipo: 'disparosLejanos', dura: 9, cada: 0.45 },
      { en: 1.2, tipo: 'cañonazo', fuerza: 0.4 },
    ],
  },
  {
    nombre: '2 · Desde la cañonera en vuelo',
    duracion: 6,
    fundidoEntrada: 0.7,
    actores: ['canonera', 'piernas'],
    camara: {
      tipo: 'canonera',
      desde: { pos: [1.25, -1.9, -0.1], mira: [0.9, -5.6, -4.5] },
      hasta: { pos: [1.1, -2.0, -0.35], mira: [1.2, -5.5, -4.5] },
    },
    angulo: 62,
    temblor: 0.35,
    eventos: [
      { en: 0, tipo: 'motor', encender: true },
      { en: 3.8, tipo: 'cañonazo', fuerza: 0.5 },
      { en: 5.8, tipo: 'motor', encender: false },
    ],
    dialogos: [
      { en: 0.5, quien: 'SOLDADO', texto: 'Comandante, tenemos una cañonera derribada en el sector siete.', voz: 'soldado-1', filtro: 'radio', dura: 3.4 },
      // La respuesta sigue sonando por radio sobre el plano de la cañonera estrellada (toma 3)
      { en: 4.2, quien: 'COMANDANTE', texto: 'Parece que nuestros compañeros no han tenido la misma suerte. No podemos bajar, seguimos rumbo.', voz: 'comandante-1', filtro: 'radio', dura: 5.2 },
    ],
  },
  {
    nombre: '3 · La cañonera estrellada',
    duracion: 4,
    camara: { tipo: 'orbita', centro: [0.3, 1.6, -1.9], radio: 11, radioHasta: 9.5, altura: 2.6, giroDesde: 205, giroHasta: 250 },
    angulo: 55,
    temblor: 0.08,
    eventos: [
      { en: 0, tipo: 'fuego', dura: 4.2 },
      { en: 1.6, tipo: 'explosion', donde: [-2.6, 1.6, 0.6], fuerza: 0.45 },
    ],
  },
  {
    nombre: '4 · Droides en la neblina',
    duracion: 5,
    camara: {
      tipo: 'recorrido',
      desde: { pos: [-4, 1.4, -51], mira: [1, 1.5, -74] },
      hasta: { pos: [-3.5, 1.3, -53], mira: [1, 1.4, -74] },
    },
    angulo: 28,
    temblor: 0.05,
    neblina: { cerca: 3, lejos: 58 },
    actores: ['droides'],
    eventos: [{ en: 2.8, tipo: 'cañonazo', fuerza: 0.35 }],
  },
  {
    nombre: '5 · El comando tras la cobertura',
    duracion: 5,
    actores: ['comando'],
    camara: {
      tipo: 'recorrido',
      desde: { pos: [-2.4, 2.2, 1.0], mira: [-4.6, 1.3, 4.1] },
      hasta: { pos: [-2.75, 2.25, 1.45], mira: [-4.6, 1.35, 4.1] },
    },
    angulo: 30,
    temblor: 0.06,
    posturas: [
      { en: 0, agachado: 1, asoma: 0, golpe: 0 },
      { en: 0.9, asoma: 1 },
      { en: 1.3, golpe: 0 },
      { en: 1.6, golpe: 1 },
      { en: 2.05, golpe: 0.92 },
      { en: 2.2, golpe: 1 },
      { en: 2.7, golpe: 0 },
      { en: 3.4, asoma: 0.6 },
    ],
    eventos: [
      { en: 1.55, tipo: 'golpeCasco' },
      { en: 1.7, tipo: 'estatica', dura: 0.9, filtro: 'casco' },
    ],
    dialogos: [
      { en: 2.6, quien: 'TÚ', texto: 'Rayos... las comunicaciones están fritas. Tendré que apañármelas solo.', voz: 'comando-1', filtro: 'casco', dura: 4.0 },
    ],
  },
  {
    nombre: '6 · A primera persona',
    duracion: 2.3,
    fundidoSalida: 0.35,
    actores: ['comando'],
    camara: {
      tipo: 'recorrido',
      desde: { pos: [-3.4, 1.9, 7.3], mira: [-4.35, 1.3, 3.2] },
      hasta: { pos: [-4.35, 1.85, 4.62], mira: [-4.35, 1.6, -1] },
    },
    angulo: 60,
    temblor: 0.04,
    posturas: [
      { en: 0, agachado: 1, asoma: 0.6, golpe: 0 },
      { en: 0.25, agachado: 1, asoma: 0.3 },
      { en: 1.0, agachado: 0, asoma: 0 },
    ],
  },
];

/** Tras el último fundido a negro: cuánto tarda en volver la imagen ya jugando (s) y cuándo aparece «Ronda 1». */
export const SALIDA = { fundido: 0.7 };
