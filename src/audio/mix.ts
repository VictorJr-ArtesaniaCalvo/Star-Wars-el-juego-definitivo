import { Howler } from 'howler';

// Mezcla de sonido: un multiplicador de volumen para cada sonido del juego (1 = como suena ahora; 0,5 = la mitad; 2 = el doble).
// Se ajustan en directo en los paneles del modo de pruebas (uno por grupo) y, con «Copiar valores», Víctor pasa los números para
// dejarlos fijos aquí.

/** Viento y ambiente (panel «MEZCLA: VIENTO»). */
export const MIX_VIENTO = {
  fondoCanon: 1, // viento de fondo del cañón (audios nuevos)
  fondoTunel: 1, // fondo del túnel (paso a la arena)
  fondoArena: 1, // viento de fondo de la arena
  rafagas: 1, // ráfagas grabadas
  subida: 1, // cuánto sube el fondo durante una ráfaga
  antesFondo: 1, // viento generado de antes (opción «Antes»)
  antesRafaga: 1, // golpe de ráfaga generado (en la arena, y en todo con «Antes»)
};
/** Combate (panel «MEZCLA: COMBATE»). */
export const MIX_COMBATE = {
  blaster: 1, // tu bláster
  calor: 1, // sobrecalentamiento y «listo» del bláster
  droides: 1, // disparos de los B1 y B2
  droideka: 1, // disparos de los droidekas
  cargarArma: 1, // «cargar el arma» de los B1 al aparecer
  granadaPitido: 1, // pitido del detonador
  explosion: 1, // explosión de la granada
  lanzar: 1, // lanzar la granada (silbido)
  rebote: 1, // rebote de la granada
  kit: 1, // coger un kit médico
};
/** Cinemáticas (panel «MEZCLA: CINEMÁTICAS»). */
export const MIX_CINE = {
  interior: 1, // interior de la cañonera en vuelo (grabado)
  pasada: 1, // pasada rasante de la cañonera (grabada)
  motor: 1, // motor generado de la cañonera (si no hay grabación)
  golpe: 1, // golpe con los nudillos en el casco
  fuego: 1, // crepitar del fuego
  escudos: 1, // escudos de los droidekas encendiéndose
  pasos: 1, // pasos con eco en el túnel
  disparosLejanos: 1, // disparos lejanos de fondo
  canonazos: 1, // cañonazos lejanos
};
/** Música (panel «MEZCLA: MÚSICA»); se suma al control de música de AJUSTES. */
export const MIX_MUSICA = {
  canon: 1, // música de la partida en el cañón (y la cinemática inicial)
  arena: 1, // música de la arena
  menu: 1, // música de la pantalla principal
};

type Group = Record<string, number>;
const buses: Array<{ g: GainNode; group: Group; key: string }> = [];

/**
 * Salida con su volumen de mezcla para los sonidos hechos con Web Audio (cinemáticas): conecta lo que se quiera a ella en vez de a la
 * salida general. Sigue al panel en directo.
 */
export function mixBus(group: Group, key: string): AudioNode | null {
  const ctx = Howler.ctx, master = Howler.masterGain;
  if (!ctx || !master) return null;
  let b = buses.find((x) => x.group === group && x.key === key);
  if (!b) {
    const g = ctx.createGain();
    g.gain.value = group[key];
    g.connect(master);
    b = { g, group, key };
    buses.push(b);
  }
  return b.g;
}

/** Los paneles han cambiado algún valor: se aplica a las salidas de mezcla. */
export function refreshMix() {
  for (const b of buses) b.g.gain.value = b.group[b.key];
}
