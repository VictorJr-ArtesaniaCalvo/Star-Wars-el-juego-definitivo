import { FP_HANDS, FP_STATE, type HandSetup } from '../player/commandoModel';
import { HIP } from '../weapons/ViewModel';

// Panel del modo de pruebas para ajustar en directo los brazos en primera persona: posición y giro de cada mano en el arma,
// cuánto se cierran los dedos, de dónde viene el antebrazo y el tamaño de los brazos. «Copiar valores» copia los números
// para pasárselos al desarrollador, que los deja fijos en `FP_HANDS` (src/player/commandoModel.ts).

export interface TunerHooks {
  /** Alterna entre disparar desde la cadera y apuntar. */
  toggleAim: () => void;
  /** Mira arriba (+1), al frente (0) o abajo (−1). */
  look: (dir: number) => void;
  /** Cierra el panel (vuelve la partida normal). */
  close: () => void;
}

type Field = { key: string; label: string; min: number; max: number; step: number; get: (h: HandSetup) => number; set: (h: HandSetup, v: number) => void; only?: 'r' };

const FIELDS: Field[] = [
  { key: 'x', label: 'Mover: lado (derecha +)', min: -0.3, max: 0.3, step: 0.002, get: (h) => h.pos[0], set: (h, v) => { h.pos[0] = v; } },
  { key: 'y', label: 'Mover: altura (arriba +)', min: -0.4, max: 0.2, step: 0.002, get: (h) => h.pos[1], set: (h, v) => { h.pos[1] = v; } },
  { key: 'z', label: 'Mover: profundidad (atrás +)', min: -0.5, max: 0.4, step: 0.002, get: (h) => h.pos[2], set: (h, v) => { h.pos[2] = v; } },
  { key: 'rx', label: 'Girar: cabeceo (°)', min: -180, max: 180, step: 1, get: (h) => h.rot[0], set: (h, v) => { h.rot[0] = v; } },
  { key: 'ry', label: 'Girar: hacia los lados (°)', min: -180, max: 180, step: 1, get: (h) => h.rot[1], set: (h, v) => { h.rot[1] = v; } },
  { key: 'rz', label: 'Girar: sobre sí misma (°)', min: -180, max: 180, step: 1, get: (h) => h.rot[2], set: (h, v) => { h.rot[2] = v; } },
  { key: 'dedos', label: 'Cerrar dedos', min: 0, max: 1, step: 0.01, get: (h) => h.dedos, set: (h, v) => { h.dedos = v; } },
  { key: 'pulgar', label: 'Cerrar pulgar', min: 0, max: 1, step: 0.01, get: (h) => h.pulgar, set: (h, v) => { h.pulgar = v; } },
  { key: 'indice', label: 'Cerrar índice (gatillo)', min: 0, max: 1, step: 0.01, get: (h) => h.indice, set: (h, v) => { h.indice = v; }, only: 'r' },
  { key: 'lado', label: 'Antebrazo: desde el lado (°)', min: -90, max: 90, step: 1, get: (h) => h.lado, set: (h, v) => { h.lado = v; } },
  { key: 'abajo', label: 'Antebrazo: desde abajo (°)', min: 0, max: 89, step: 1, get: (h) => h.abajo, set: (h, v) => { h.abajo = v; } },
];

const round = (v: number, step: number) => +(Math.round(v / step) * step).toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0);

export class HandTuner {
  private root: HTMLDivElement;
  private side: 'r' | 'l' = 'l';
  private inputs = new Map<string, { range: HTMLInputElement; num: HTMLSpanElement; field: Field; row: HTMLElement }>();
  private gunInputs: Array<{ range: HTMLInputElement; num: HTMLSpanElement; key: keyof typeof HIP; step: number }> = [];
  private size!: HTMLInputElement;
  private len!: HTMLInputElement;
  private lenVal!: HTMLSpanElement;
  private sizeVal!: HTMLSpanElement;
  private warn!: HTMLDivElement;
  private timer = 0;

  constructor(hooks: TunerHooks) {
    const d = document.createElement('div');
    d.id = 'handTuner';
    d.hidden = true;
    d.innerHTML = `
      <div class="ht-head"><b>AJUSTE DE MANOS</b><button data-a="close">✕</button></div>
      <div class="ht-sub">ARMA</div>
      <div class="ht-gun"></div>
      <div class="ht-sub">MANOS</div>
      <div class="ht-seg"><button data-side="r">Mano derecha</button><button data-side="l">Mano izquierda</button></div>
      <div class="ht-fields"></div>
      <label class="ht-row"><span>Tamaño de los brazos <i class="ht-size"></i></span><input type="range" class="ht-sizeR" min="0.6" max="1.4" step="0.01"></label>
      <label class="ht-row"><span>Largo del antebrazo <i class="ht-len"></i></span><input type="range" class="ht-lenR" min="1" max="2.5" step="0.01"></label>
      <div class="ht-warn" hidden>⚠ Se ve el corte del brazo: cambia el ángulo del antebrazo</div>
      <div class="ht-seg"><button data-a="aim">Cadera / Apuntar</button></div>
      <div class="ht-seg"><button data-a="up">Mirar arriba</button><button data-a="mid">Al frente</button><button data-a="down">Mirar abajo</button></div>
      <div class="ht-seg"><button data-a="copy" class="ht-copy">Copiar valores</button></div>
      <textarea class="ht-out" readonly hidden></textarea>`;
    document.body.appendChild(d);
    this.root = d;
    const fields = d.querySelector('.ht-fields')!;
    for (const f of FIELDS) {
      const row = document.createElement('label');
      row.className = 'ht-row';
      row.innerHTML = `<span>${f.label} <i></i></span><input type="range" min="${f.min}" max="${f.max}" step="${f.step}">`;
      const range = row.querySelector('input')!, num = row.querySelector('i')!;
      range.addEventListener('input', () => {
        const v = Number(range.value);
        f.set(this.hand(), v);
        num.textContent = String(round(v, f.step));
        FP_STATE.version++;
      });
      fields.appendChild(row);
      this.inputs.set(f.key, { range, num, field: f, row });
    }
    // Arma: posición en pantalla y tamaño (las manos la siguen solas)
    const gunBox = d.querySelector('.ht-gun')!;
    const GUN: Array<[keyof typeof HIP, string, number, number, number]> = [
      ['x', 'Arma: lado (derecha +)', -0.2, 0.5, 0.002],
      ['y', 'Arma: altura (arriba +)', -0.5, 0.1, 0.002],
      ['z', 'Arma: distancia (más lejos −)', -1.2, -0.2, 0.002],
      ['scale', 'Arma: tamaño', 0.25, 1.2, 0.005],
      ['adsLift', 'Arma: cuánto sube al apuntar', -0.1, 0.25, 0.002],
    ];
    for (const [k, label, min, max, step] of GUN) {
      const row = document.createElement('label');
      row.className = 'ht-row';
      row.innerHTML = `<span>${label} <i></i></span><input type="range" min="${min}" max="${max}" step="${step}">`;
      const range = row.querySelector('input')!, num = row.querySelector('i')!;
      range.addEventListener('input', () => { HIP[k] = Number(range.value); num.textContent = String(round(HIP[k], step)); FP_STATE.version++; });
      gunBox.appendChild(row);
      this.gunInputs.push({ range, num, key: k, step });
    }
    this.size = d.querySelector('.ht-sizeR')!;
    this.sizeVal = d.querySelector('.ht-size')!;
    this.size.addEventListener('input', () => { FP_HANDS.tamano = Number(this.size.value); this.sizeVal.textContent = String(round(FP_HANDS.tamano, 0.01)); FP_STATE.version++; });
    this.len = d.querySelector('.ht-lenR')!;
    this.lenVal = d.querySelector('.ht-len')!;
    this.len.addEventListener('input', () => { FP_HANDS.largo = Number(this.len.value); this.lenVal.textContent = String(round(FP_HANDS.largo, 0.01)); FP_STATE.version++; });
    this.warn = d.querySelector('.ht-warn')!;
    d.querySelectorAll<HTMLButtonElement>('[data-side]').forEach((b) => b.addEventListener('click', () => { this.side = b.dataset.side as 'r' | 'l'; this.refresh(); }));
    d.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.a;
      if (a === 'close') hooks.close();
      else if (a === 'aim') hooks.toggleAim();
      else if (a === 'up') hooks.look(1);
      else if (a === 'mid') hooks.look(0);
      else if (a === 'down') hooks.look(-1);
      else if (a === 'copy') this.copy(b);
    }));
    // que tocar el panel no mueva la cámara ni dispare
    for (const ev of ['pointerdown', 'touchstart', 'mousedown', 'click']) d.addEventListener(ev, (e) => e.stopPropagation());
  }

  private hand(): HandSetup { return this.side === 'r' ? FP_HANDS.derecha : FP_HANDS.izquierda; }

  private refresh() {
    const h = this.hand();
    this.root.querySelectorAll<HTMLButtonElement>('[data-side]').forEach((b) => b.classList.toggle('on', b.dataset.side === this.side));
    for (const { range, num, field, row } of this.inputs.values()) {
      row.hidden = field.only !== undefined && field.only !== this.side;
      const v = field.get(h);
      range.value = String(v);
      num.textContent = String(round(v, field.step));
    }
    for (const g of this.gunInputs) { g.range.value = String(HIP[g.key]); g.num.textContent = String(round(HIP[g.key], g.step)); }
    this.size.value = String(FP_HANDS.tamano);
    this.sizeVal.textContent = String(round(FP_HANDS.tamano, 0.01));
    this.len.value = String(FP_HANDS.largo);
    this.lenVal.textContent = String(round(FP_HANDS.largo, 0.01));
  }

  private copy(btn: HTMLButtonElement) {
    const r = (h: HandSetup) => ({ pos: h.pos.map((v) => round(v, 0.002)), rot: h.rot.map((v) => round(v, 1)), dedos: round(h.dedos, 0.01), pulgar: round(h.pulgar, 0.01), indice: round(h.indice, 0.01), lado: round(h.lado, 1), abajo: round(h.abajo, 1) });
    const gun = { x: round(HIP.x, 0.002), y: round(HIP.y, 0.002), z: round(HIP.z, 0.002), tamano: round(HIP.scale, 0.005), subeAlApuntar: round(HIP.adsLift, 0.002) };
    const text = 'MANOS ' + JSON.stringify({ arma: gun, tamano: round(FP_HANDS.tamano, 0.01), largo: round(FP_HANDS.largo, 0.01), derecha: r(FP_HANDS.derecha), izquierda: r(FP_HANDS.izquierda) });
    const out = this.root.querySelector<HTMLTextAreaElement>('.ht-out')!;
    out.value = text;
    const done = () => { btn.textContent = 'Copiado ✓'; setTimeout(() => (btn.textContent = 'Copiar valores'), 1800); };
    const fallback = () => { out.hidden = false; out.focus(); out.select(); btn.textContent = 'Selecciona y copia el texto'; };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  show() {
    this.refresh();
    this.root.hidden = false;
    clearInterval(this.timer);
    this.timer = window.setInterval(() => { this.warn.hidden = !FP_STATE.corteVisible; }, 300);
  }

  hide() {
    this.root.hidden = true;
    clearInterval(this.timer);
  }

  get open() { return !this.root.hidden; }
}
