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
  /** Ruido grabado del interior de la cañonera: 0 = desde fuera (más lejano y con viento) · 1 = desde dentro (más presente). */
  cabina?: number;
}

// ---------- Lugares fijos ----------
/**
 * Zona de aparición: el comando está en el borde norte del cráter (1,5 m más allá de su parte más alta), al este de la punta del ala apoyada,
 * mirando al norte (por donde llegan los droides en la ronda 1) y con la nave a su espalda. Ahí termina la cinemática y ahí empieza
 * la partida, también al reintentar.
 */
export const COMANDO = { x: 4.0, z: -14.0 };
/** Caja de la República tras la que se cubre, justo delante de él y de cara al norte (cobertura sólida del mapa). `giro` en radianes. */
export const COBERTURA = { x: 4.0, z: -15.2, giro: 0 };

/** Vuelo de la cañonera durante la toma 2 (2A y 2B). */
export const VUELO = {
  /** Pasada en línea recta a lo largo del cañón, de sur a norte, por el lado derecho: la puerta abierta (lado izquierdo de la nave) da a la cañonera estrellada. */
  inicio: [20, 100] as [number, number],
  fin: [20, -32] as [number, number],
  /** Segundos que tarda (lo que duran las tomas 2A y 2B juntas): 132 m en 11 s ≈ 43 km/h; la cañonera estrellada queda de través hacia el segundo 8,5. */
  duracion: 11,
  /** Altura sobre el suelo del cráter (m) e inclinación lateral (grados). */
  altura: 22,
  alabeo: 5,
};

/** Dónde están de pie los dos soldados (clon normal y, a su derecha, el comando) junto a la puerta abierta (dentro de la nave, en metros; el suelo de la bahía está a ‑3,35). `separacion`: entre uno y otro. */
export const PIERNAS = { x: 0.81, suelo: -3.35, z: -0.68, separacion: 1.75 }; // cada uno con un asa del techo delante (x 0,96 y 2,41)

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
    nombre: '2A · La cañonera en vuelo, desde fuera',
    duracion: 4,
    cabina: 0,
    fundidoEntrada: 0.7,
    actores: ['canonera', 'piernas'], // 'piernas' = los dos soldados de la puerta (clon normal y comando)
    camara: {
      tipo: 'canonera',
      // volando a la par de la nave, delante de la puerta abierta: se ve a los dos soldados de frente y el suelo pasar por debajo
      desde: { pos: [1.0, -2.4, -5.6], mira: [1.8, -2.2, 0] },
      hasta: { pos: [1.7, -2.0, -4.8], mira: [1.7, -2.3, 0] },
    },
    angulo: 56,
    temblor: 0.45,
    eventos: [
      { en: 0, tipo: 'motor', encender: true },
    ],
    dialogos: [
      { en: 0.4, quien: 'SOLDADO', texto: 'Comandante, tenemos una cañonera derribada en el sector siete.', voz: 'soldado-1', filtro: 'radio', dura: 3.3 },
    ],
  },
  {
    nombre: '2B · Desde dentro, mirando a la cañonera estrellada',
    duracion: 7,
    cabina: 1,
    actores: ['canonera', 'piernas'],
    camara: {
      tipo: 'canonera',
      // por encima de los hombros de los dos soldados, mirando abajo a nuestra cañonera estrellada
      desde: { pos: [1.75, -1.2, 1.15], mira: [5.5, -6.8, -6.6] },
      hasta: { pos: [1.6, -1.25, 1.05], mira: [2.4, -7.2, -7.6] },
    },
    angulo: 64,
    temblor: 0.35,
    eventos: [
      { en: 2.4, tipo: 'cañonazo', fuerza: 0.5 },
      { en: 6.6, tipo: 'motor', encender: false },
    ],
    dialogos: [
      { en: 0.3, quien: 'COMANDANTE', texto: 'Parece que nuestros compañeros no han tenido la misma suerte. No podemos bajar, seguimos rumbo.', voz: 'comandante-1', filtro: 'radio', dura: 4.4 },
    ],
  },
  {
    nombre: '3 · La cañonera estrellada',
    duracion: 4,
    camara: { tipo: 'orbita', centro: [0.3, 1.4, -3.1], radio: 15, radioHasta: 13, altura: 3.2, giroDesde: 205, giroHasta: 250 },
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
    duracion: 6,
    actores: ['comando'],
    camara: {
      tipo: 'recorrido',
      desde: { pos: [5.95, 2.2, -17.1], mira: [3.75, 1.3, -14.0] },
      hasta: { pos: [5.6, 2.25, -16.65], mira: [3.75, 1.35, -14.0] },
    },
    angulo: 30,
    temblor: 0.06,
    posturas: [
      { en: 0, agachado: 1, asoma: 0, golpe: 0 },
      { en: 0.8, asoma: 1 },
      { en: 1.0, golpe: 0 },
      { en: 1.3, golpe: 1 },
      { en: 1.55, golpe: 0.92 },
      { en: 1.65, golpe: 1 },
      { en: 2.1, golpe: 0 },
      { en: 3.6, asoma: 0.6 },
    ],
    eventos: [
      { en: 1.25, tipo: 'golpeCasco' },
      // justo después del golpe, una ráfaga de estática en la radio del casco
      { en: 1.4, tipo: 'estatica', dura: 0.6, filtro: 'casco' },
    ],
    dialogos: [
      { en: 2.05, quien: 'TÚ', texto: 'Rayos... las comunicaciones están fritas. Tendré que apañármelas solo.', voz: 'comando-1', filtro: 'casco', dura: 3.8 },
    ],
  },
  {
    nombre: '6 · A primera persona',
    duracion: 2.3,
    fundidoSalida: 0.35,
    actores: ['comando'],
    camara: {
      tipo: 'recorrido',
      desde: { pos: [4.95, 1.9, -10.8], mira: [4.0, 1.3, -14.9] },
      hasta: { pos: [4.0, 1.85, -13.48], mira: [4.0, 1.6, -19.1] },
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
