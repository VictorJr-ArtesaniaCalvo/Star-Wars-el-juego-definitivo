// ============================================================================
//  GUION DE LA CINEMÁTICA DE PASO A LA ARENA (al acabar la ronda 6)
// ============================================================================
// El guion es de Víctor (con sus cambios: sin la carrera larga; entrada a la cueva más larga): 10 tomas, unos 38 s. Todo lo que se ve y se oye está aquí, para ajustarlo cambiando números.
// El reproductor es src/cinematic/ArenaCinematic.ts (cámaras, actores, disparos, sonidos).
//
// CÓMO LEER LAS POSICIONES (igual que en script.ts)
//  · [x, z] o [x, altura, z] en metros. x: oeste (−) / este (+) · z: norte (−) / sur (+).
//  · En el cañón la altura es SOBRE EL SUELO de ese punto. En la arena el suelo está a 0 (la arena es llana).
//  · `en` / `dura`: segundos desde que empieza la toma.  · `angulo`: campo de visión (menos = más zoom; el juego usa 72).
// ============================================================================

export type Quien2 = 'PILOTO' | 'TÚ';

export interface Dialogo2 {
  en: number;
  quien: Quien2;
  texto: string;
  /** Archivo de voz (public/audio/voces/<voz>.mp3). Mientras no exista, solo sale el subtítulo. */
  voz: string;
  /** 'piloto' = radio de la cañonera, más sucia · 'casco' = el comando dentro de su casco. */
  filtro: 'piloto' | 'casco';
  /** Segundos en pantalla mientras no haya archivo de voz. */
  dura: number;
}

export type Evento2 =
  | { en: number; tipo: 'chisporroteo'; dura: number } // la radio del casco chisporrotea (estática corta)
  | { en: number; tipo: 'radioVuelve'; dura: number } // estática fuerte que se va limpiando (la cañonera conecta)
  | { en: number; tipo: 'escudos' } // los dos droidekas encienden el escudo a la vez
  | { en: number; tipo: 'cortinilla' } // la cortinilla negra de la pantalla de inicio (en negro se pasa del cañón a la arena)
  | { en: number; tipo: 'cañonazo'; fuerza: number };

export type TomaId =
  | 'pasada' | 'combate' | 'radioA' | 'radioB' | 'respuesta' | 'entrada'
  | 'tunel' | 'arena' | 'droides' | 'dekas' | 'escudos' | 'cierre' | 'ronda';

export interface Toma2 {
  id: TomaId;
  nombre: string;
  duracion: number;
  angulo: number;
  /** 0 = cámara quieta · 0,3 = cámara al hombro · 1 = mucho. */
  temblor?: number;
  fundidoEntrada?: number;
  fundidoSalida?: number;
  /** Pantalla en negro con un texto grande en el centro. */
  negro?: boolean;
  titulo?: { texto: string; entra: number; sale: number };
  /** Texto discreto en una esquina (abajo a la izquierda). */
  rotulo?: { texto: string; entra: number; sale: number };
  dialogos?: Dialogo2[];
  eventos?: Evento2[];
}

// ---------- Lugares ----------
/** El comando en el cañón: tras la caja de cobertura del punto de aparición, mirando al norte (por donde vienen los droides). */
export const COMANDO2 = { x: 4.0, z: -14.0 };
/** Droides B1 del tiroteo (tomas 2 y 3), al norte, disparando hacia el comando. */
export const DROIDES_CAÑON: Array<[number, number]> = [[-4, -43], [1.5, -47], [7, -41], [11.5, -49], [-8.5, -51], [4.5, -55]];

/**
 * Carrera hacia la cueva (se ve en la toma 5, cuando llega y se mete). Sigue estos puntos hasta la boca de la cueva (la boca la pone
 * src/world/cave.ts; aquí solo los puntos de antes, esquivando las rocas). El corte de la toma 4 a la 5 disimula el tramo que no se ve.
 */
export const CARRERA = {
  // zigzag por la arena libre, esquivando las rocas del camino (comprobado en el mapa desde arriba)
  puntos: [[-3, -21.5], [-13, -22], [-17.5, -23.6], [-20.5, -22.3], [-23.5, -21], [-29.5, -20.5], [-34, -22.2]] as Array<[number, number]>,
  /** Velocidad corriendo (m/s), cuánto entra en la cueva (m) y en qué segundo de la toma 5 cruza la boca. */
  velocidad: 6.3,
  dentro: 6,
  cruza: 2.6,
};

/** La cañonera aliada: pasada rasante (toma 1) y vueltas sobre el cañón vista desde abajo (toma 3B). */
export const VUELO2 = {
  /** Pasada de sur a norte: desde, hasta ([x, altura sobre el suelo, z]) y segundos. */
  pasada: { desde: [-1, 27, 95] as [number, number, number], hasta: [-6, 33, -95] as [number, number, number], dura: 5.2, empieza: 0 }, // bastante alta (Víctor); pasa sobre la cámara hacia el segundo 2,2
  /** Cámara de la pasada: muy baja junto a unas rocas (al este del cráter), mirando hacia donde viene la nave. */
  camara: [10, 0.55, 14] as [number, number, number],
  /** Vueltas sobre el cañón: centro, radio, altura (m) y ángulos (grados, 0 = este, 90 = sur) al empezar y acabar la toma 3B. */
  // círculo ancho (150° durante las tomas 3A y 3B juntas: 10,5 s, unos 10 m/s) y muy inclinado en el giro, ladeada hacia dentro del círculo (Víctor)
  orbita: { centro: [0, -24] as [number, number], radio: 40, altura: 36, giroDesde: 100, giroHasta: 250, alabeo: 40 },
};

/** La arena (después de la cortinilla). La puerta sur está en z = 41,4; su túnel sigue hacia +z. */
export const ARENA2 = {
  /** Túnel: dónde empieza y acaba la carrera (z) y por qué lado va (x). */
  tunel: { desde: 55, hasta: 46.5, x: 0.3 },
  /** Al salir del túnel (toma 9): empieza a frenar en `frena` (z) y se queda donde le deje la animación (unos 3 m más allá). */
  frena: 42.8,
  /** Droides B1 en la arena, de espaldas al principio; se giran hacia el comando uno tras otro (`gira`: segundo de la toma 9). */
  b1: [
    { x: -7.5, z: 34, gira: 0.85 }, { x: -9.5, z: 29.5, gira: 1.1 }, { x: 6.5, z: 33.5, gira: 0.95 },
    { x: 10, z: 30, gira: 1.3 }, { x: 1.5, z: 24, gira: 1.55 },
  ],
  /** Droidekas: entran rodando desde `desde` hasta `hasta` ([x, z]) y se despliegan mirando al comando (a unos 10 m de él). */
  dekas: [
    { desde: [-12, 18] as [number, number], hasta: [-1.0, 28.0] as [number, number] },
    { desde: [13, 18] as [number, number], hasta: [3.4, 29.5] as [number, number] },
  ],
  /** Segundos rodando (frenan al final) y en desplegarse. */
  rueda: 1.45,
  despliega: 0.85,
};

// ---------- Las tomas ----------
export const TOMAS2: Toma2[] = [
  {
    id: 'pasada',
    nombre: '1 · Cañonera aliada (pasada rasante)',
    duracion: 4,
    angulo: 62,
    temblor: 0.12,
    fundidoEntrada: 0.6,
  },
  {
    id: 'combate',
    nombre: '2 · El comando en combate',
    duracion: 4,
    angulo: 54,
    temblor: 0.18,
    eventos: [
      { en: 1.5, tipo: 'chisporroteo', dura: 0.35 },
      { en: 2.6, tipo: 'chisporroteo', dura: 0.6 },
      { en: 3.5, tipo: 'chisporroteo', dura: 0.5 },
    ],
  },
  {
    id: 'radioA',
    nombre: '3A · La radio vuelve: mira al cielo',
    duracion: 5.9, // la primera frase del piloto (4,6 s, empieza en 0,8) entera + medio segundo (antes 4)
    angulo: 40,
    temblor: 0.08,
    eventos: [{ en: 0.05, tipo: 'radioVuelve', dura: 6.4 }], // la estática se va limpiando durante toda la frase (antes 4,4)
    dialogos: [
      { en: 0.8, quien: 'PILOTO', texto: 'Comando, aquí cañonera Tres-Siete, ¿me recibe? No podemos aterrizar ahí.', voz: 'c2_piloto_1', filtro: 'piloto', dura: 4.6 }, // dura 4,6 s ya recortada
    ],
  },
  {
    id: 'radioB',
    nombre: '3B · La cañonera gira sobre el cañón (desde abajo)',
    duracion: 4.6, // la segunda frase del piloto (3,6 s, empieza en 0,45) entera + medio segundo (antes 4)
    angulo: 58,
    temblor: 0.06,
    dialogos: [
      { en: 0.45, quien: 'PILOTO', texto: 'Llegue a la arena por los túneles. Allí le cubriremos y le sacaremos.', voz: 'c2_piloto_2', filtro: 'piloto', dura: 3.6 }, // dura 3,6 s ya recortada
    ],
  },
  {
    id: 'respuesta',
    nombre: '4 · Respuesta y se levanta',
    duracion: 2.5, // «Recibido. Voy para allá.» (1,7 s, empieza en 0,1) ya cabe con margen: no cambia
    angulo: 44,
    temblor: 0.08,
    dialogos: [
      { en: 0.1, quien: 'TÚ', texto: 'Recibido. Voy para allá.', voz: 'c2_comando', filtro: 'casco', dura: 1.7 }, // dura 1,7 s ya recortada
    ],
  },
  {
    id: 'entrada',
    nombre: '5 · Llega corriendo a la cueva y entra (cortinilla)',
    duracion: 3.8,
    angulo: 50,
    temblor: 0.18,
    eventos: [{ en: 1.0, tipo: 'cañonazo', fuerza: 0.3 }, { en: 2.65, tipo: 'cortinilla' }],
  },
  {
    id: 'tunel',
    nombre: '6 · Túnel: silueta a contraluz',
    duracion: 2.5,
    angulo: 54,
    temblor: 0.2,
  },
  {
    id: 'arena',
    nombre: '7 · La arena desde lo alto',
    duracion: 4,
    angulo: 58,
    temblor: 0.03,
    fundidoEntrada: 0.35,
    rotulo: { texto: 'Arena de Petranaki · Geonosis', entra: 0.6, sale: 3.5 },
  },
  {
    id: 'droides',
    nombre: '8 · Sale a la arena y los B1 se giran',
    duracion: 3,
    angulo: 50,
    temblor: 0.1,
  },
  {
    id: 'dekas',
    nombre: '9A · Llegan rodando los droidekas y se despliegan',
    duracion: 2.6,
    angulo: 48,
    temblor: 0.08,
  },
  {
    id: 'escudos',
    nombre: '9B · Primer plano: los escudos se encienden',
    duracion: 1.4,
    angulo: 40,
    temblor: 0.05,
    eventos: [{ en: 0.3, tipo: 'escudos' }],
  },
  {
    id: 'cierre',
    nombre: '10 · Levanta el rifle',
    duracion: 1,
    angulo: 46,
    temblor: 0.05,
    fundidoSalida: 0.5,
  },
  {
    id: 'ronda',
    nombre: '· «Ronda 7» en negro',
    duracion: 1.3,
    angulo: 60,
    negro: true,
    titulo: { texto: 'RONDA 7', entra: 0.05, sale: 1.0 },
  },
];

/** Tras el último negro: lo que tarda en volver la imagen ya jugando (s). */
export const SALIDA2 = { fundido: 0.7 };

/** Archivos de voz de esta cinemática (para descargarlos al cargar el juego). */
export const VOCES2 = TOMAS2.flatMap((s) => (s.dialogos ?? []).map((d) => d.voz));
