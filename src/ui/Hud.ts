// Indicadores en pantalla: vida, ronda, calor del bláster, avisos, daño recibido y pausa.
// Las granadas se añadirán en la Fase 4.
import { Compass, type CompassMarker } from './Compass';

const $ = (id: string) => document.getElementById(id)!;

export class Hud {
  private root = $('hud');
  private touch = $('touch');
  private stance = $('stance');
  private btnCrouch = $('btnCrouch');
  private crouching: boolean | null = null;
  private heat = $('heat');
  private heatFill = $('heatFill');
  private heatLabel = $('heatLabel');
  private hitmark = $('hitmark');
  private hitLife = 0;
  private lastHeat = -1;
  private lastLocked: boolean | null = null;

  private hpBar = $('hpBar');
  private hpFill = $('hpFill');
  private hpLabel = $('hpLabel');
  private lastHp = -1;
  private roundNum = $('roundNum');
  private enemyLeft = $('enemyLeft');
  private lastRound = -1;
  private lastLeft = -1;
  private banner = $('banner');
  private bannerLife = 0;
  private damage = $('damage');
  private dmgDir = $('dmgDir');
  private dmgLife = 0;
  private dirLife = 0;
  private compass = new Compass();
  private healPopEl = $('healPop');
  private btnAim = $('btnAim');
  private btnGrenade = $('btnGrenade');
  private grenadeDots = Array.from(document.querySelectorAll<HTMLElement>('#grenades i'));
  private adsKey = -1;
  private fps = $('fps');
  private frames = 0;
  private fpsTime = 0;

  constructor(onPause: () => void) {
    $('btnPause').addEventListener('click', onPause);
  }

  setVisible(v: boolean, touch: boolean) {
    this.root.hidden = !v;
    this.touch.hidden = !(v && touch);
  }

  /** `toggled`: el botón de apuntar está activado; `active`: se está apuntando ahora (también al disparar con el principal). */
  setAds(toggled: boolean, active: boolean) {
    const key = (toggled ? 1 : 0) + (active ? 2 : 0);
    if (key === this.adsKey) return;
    this.adsKey = key;
    this.btnAim.classList.toggle('on', toggled);
    this.root.classList.toggle('ads', active);
  }

  /** Qué llevas en la mano: el botón de granada se enciende y los de disparo pasan a decir LANZAR. */
  setWeapon(w: 'blaster' | 'grenade') {
    const g = w === 'grenade';
    this.btnGrenade.classList.toggle('on', g);
    $('btnFire').textContent = g ? 'LANZAR' : 'DISPARAR';
    const span = document.querySelector<HTMLElement>('#btnHip span');
    if (span) span.textContent = g ? 'LANZAR' : 'CADERA';
    this.root.classList.toggle('grenadeMode', g);
  }

  /** Granadas que te quedan. */
  setGrenades(n: number) {
    this.grenadeDots.forEach((d, i) => d.classList.toggle('spent', i >= n));
    this.btnGrenade.classList.toggle('empty', n <= 0);
  }

  setHeading(yaw: number, markers: CompassMarker[] = []) {
    this.compass.draw(yaw, markers);
  }

  /** Aviso flotante junto a la vida ("+10 VIDA"). */
  healPop(text: string) {
    this.healPopEl.textContent = text;
    this.healPopEl.classList.remove('go');
    void this.healPopEl.offsetWidth;
    this.healPopEl.classList.add('go');
  }

  setHealth(hp: number) {
    const v = Math.max(0, Math.ceil(hp));
    if (v === this.lastHp) return;
    this.lastHp = v;
    this.hpFill.style.width = v + '%';
    this.hpLabel.textContent = 'VIDA ' + v;
    this.hpBar.classList.toggle('low', v <= 30);
  }

  setRound(round: number, left: number) {
    if (round !== this.lastRound) { this.lastRound = round; this.roundNum.textContent = 'RONDA ' + round; }
    if (left !== this.lastLeft) { this.lastLeft = left; this.enemyLeft.textContent = left > 0 ? `Droides: ${left}` : ''; }
  }

  showBanner(title: string, sub: string, seconds: number) {
    $('bannerTitle').textContent = title;
    $('bannerSub').textContent = sub;
    this.banner.hidden = false;
    this.bannerLife = seconds;
    // Reinicia la animación de entrada.
    this.banner.style.animation = 'none';
    void this.banner.offsetWidth;
    this.banner.style.animation = '';
  }

  hideBanner() {
    this.bannerLife = 0;
    this.banner.hidden = true;
  }

  /** Destello rojo al recibir daño y flecha hacia el lugar de donde viene (ángulo en grados, 0 = delante). */
  damaged(amount: number, angleDeg: number) {
    this.dmgLife = Math.min(1, 0.4 + amount / 16);
    this.dirLife = 1;
    this.dmgDir.style.transform = `rotate(${angleDeg}deg)`;
  }

  setTestTag(on: boolean) {
    $('testTag').hidden = !on;
  }

  setFpsVisible(on: boolean) {
    this.fps.hidden = !on;
  }

  setHeat(heat: number, locked: boolean) {
    const pct = Math.round(heat * 100);
    if (pct !== this.lastHeat) {
      this.lastHeat = pct;
      this.heatFill.style.width = pct + '%';
      // De azul (frío) a naranja y rojo (caliente).
      this.heatFill.style.background = locked ? '#ff3a20' : heat < 0.5 ? '#66b8ff' : heat < 0.8 ? '#ffb040' : '#ff6a30';
    }
    if (locked !== this.lastLocked) {
      this.lastLocked = locked;
      this.heat.classList.toggle('locked', locked);
      this.heatLabel.textContent = locked ? 'SOBRECALENTADO' : 'BLÁSTER';
    }
  }

  /** Marca en la mira al acertar a un enemigo. */
  hit(kill: boolean, shield = false) {
    this.hitLife = 1;
    this.hitmark.classList.toggle('kill', kill);
    this.hitmark.classList.toggle('shield', shield && !kill);
  }

  update(dt: number) {
    if (this.hitLife > 0) {
      this.hitLife = Math.max(0, this.hitLife - dt * 4);
      this.hitmark.style.opacity = String(this.hitLife);
    }
    if (this.bannerLife > 0) {
      this.bannerLife -= dt;
      if (this.bannerLife <= 0) this.banner.hidden = true;
    }
    if (this.dmgLife > 0) {
      this.dmgLife = Math.max(0, this.dmgLife - dt * 1.4);
      this.damage.style.opacity = String(this.dmgLife);
    }
    if (this.dirLife > 0) {
      this.dirLife = Math.max(0, this.dirLife - dt * 1.1);
      this.dmgDir.style.opacity = String(this.dirLife * 0.85);
    }
    // Contador de fotogramas por segundo (solo si está activado en el modo de pruebas).
    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      if (!this.fps.hidden) this.fps.textContent = Math.round(this.frames / this.fpsTime) + ' FPS';
      this.frames = 0;
      this.fpsTime = 0;
    }
  }

  setCrouching(c: boolean) {
    if (c === this.crouching) return;
    this.crouching = c;
    this.stance.textContent = c ? 'AGACHADO' : 'DE PIE';
    this.stance.classList.toggle('crouch', c);
    this.btnCrouch.classList.toggle('on', c);
  }
}
