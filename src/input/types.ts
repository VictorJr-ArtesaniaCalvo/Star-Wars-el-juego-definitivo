// Lo que cualquier forma de control (táctil, mando, teclado) entrega al juego.
export interface InputSource {
  /** Movimiento: x derecha(+)/izquierda(-), z adelante(+)/atrás(-). */
  move(): { x: number; z: number };
  /** Giro de la vista acumulado desde la última consulta, en radianes. */
  consumeLook(dt: number, sensitivity: number): { yaw: number; pitch: number };
  /** Pulsaciones puntuales desde la última consulta. */
  /** ¿Se está manteniendo pulsado el disparo? */
  fire(): boolean;
  /** Disparo desde la cadera (sin apuntar, salvo que ya estés apuntando). */
  fireHip(): boolean;
  /** ¿Se mantiene pulsado «apuntar»? (mando: gatillo izquierdo; ratón: botón derecho) */
  aimHeld(): boolean;
  /** Pulsación de «apuntar» que activa/desactiva el modo apuntado (botón táctil). */
  consumeAimToggle(): boolean;
  consumeCrouch(): boolean;
  consumeJump(): boolean;
  consumePause(): boolean;
}
