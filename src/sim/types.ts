// "Reglas del juego", separadas de lo que se dibuja en pantalla.
// En el futuro modo cooperativo, esto es lo que se compartirá con el servidor.

export interface PlayerState {
  id: number;
  x: number; // posición de los pies
  y: number;
  z: number;
  yaw: number; // hacia dónde mira (izquierda/derecha)
  pitch: number; // hacia dónde mira (arriba/abajo)
  crouching: boolean;
  health: number;
}

// Lo que un jugador "pide" hacer en cada instante, venga de táctil, mando o teclado.
export interface InputCommand {
  moveX: number; // -1 izquierda … 1 derecha
  moveZ: number; // -1 atrás … 1 adelante
  yaw: number;
  pitch: number;
  crouch: boolean;
}

export interface GameState {
  players: PlayerState[]; // lista: hoy hay uno, mañana podrán ser dos
}

export const TICK = 1 / 60; // pasos de simulación por segundo
