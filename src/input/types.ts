// Lo que cualquier forma de control (táctil, mando, teclado) entrega al juego.
export interface InputSource {
  /** Movimiento: x derecha(+)/izquierda(-), z adelante(+)/atrás(-). */
  move(): { x: number; z: number };
  /** Giro de la vista acumulado desde la última consulta, en radianes. */
  consumeLook(dt: number, sensitivity: number): { yaw: number; pitch: number };
  /** Pulsaciones puntuales desde la última consulta. */
  consumeCrouch(): boolean;
  consumePause(): boolean;
}
