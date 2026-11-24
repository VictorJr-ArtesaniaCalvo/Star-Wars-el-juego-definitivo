// Bláster con sobrecalentamiento: no gasta munición, pero cada disparo lo calienta.
// Si llega al tope se bloquea unos segundos hasta enfriarse del todo.
export const BLASTER = {
  fireRate: 5.5, // disparos por segundo manteniendo pulsado
  heatPerShot: 0.046, // ~22 disparos seguidos hasta sobrecalentar
  coolDelay: 0.35, // segundos sin disparar antes de empezar a enfriar
  coolRate: 0.45, // calor que pierde por segundo
  lockTime: 2.6, // segundos bloqueado al sobrecalentarse
  damage: 25,
  range: 160,
};

export class Blaster {
  heat = 0; // 0 frío … 1 tope
  locked = false;
  private sinceShot = 10;
  private cooldown = 0;

  /** Avanza el tiempo. Devuelve true si en este instante sale un disparo. */
  update(dt: number, wantFire: boolean): boolean {
    this.sinceShot += dt;
    this.cooldown -= dt;

    if (this.locked) {
      // Bloqueado: se enfría de forma constante hasta cero.
      this.heat = Math.max(0, this.heat - dt / BLASTER.lockTime);
      if (this.heat === 0) this.locked = false;
      return false;
    }

    if (wantFire && this.cooldown <= 0) {
      this.cooldown = 1 / BLASTER.fireRate;
      this.sinceShot = 0;
      this.heat = Math.min(1, this.heat + BLASTER.heatPerShot);
      if (this.heat >= 1) this.locked = true;
      return true;
    }

    if (this.sinceShot > BLASTER.coolDelay) this.heat = Math.max(0, this.heat - BLASTER.coolRate * dt);
    return false;
  }
}
