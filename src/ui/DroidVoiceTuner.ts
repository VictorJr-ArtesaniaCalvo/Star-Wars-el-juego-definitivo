import { DROID_VOICE, type DroidVoiceKey } from '../audio/DroidVoices';

// Panel del modo de pruebas para ajustar en directo las voces de los droides: distancia, esperas, probabilidad, filtro robótico,
// tono y volumen. «Probar» dice una frase al azar a 3 m o a la distancia máxima, por la izquierda (para oír la dirección y si se
// entiende de lejos). «Copiar valores» copia los números para dejarlos fijos en DROID_VOICE (src/audio/DroidVoices.ts).

export interface DroidVoiceTunerHooks {
  /** Dice una frase de prueba a `dist` m por la izquierda. */
  test: (dist: number) => void;
}

const FIELDS: Array<[DroidVoiceKey, string, number, number, number]> = [
  ['distancia', 'Distancia máxima para hablar (m)', 5, 30, 0.5],
  ['esperaMin', 'Espera entre frases: mínimo (s)', 0, 20, 0.5],
  ['esperaMax', 'Espera entre frases: máximo (s)', 0, 30, 0.5],
  ['esperaAvistado', 'Espera de «avistado» (s)', 0, 60, 1],
  ['esperaBuscando', 'Espera de «buscando» (s)', 0, 60, 1],
  ['esperaRecibido', 'Espera de «recibido» (s)', 0, 60, 1],
  ['esperaOtras', 'Espera de las demás frases (s)', 0, 60, 1],
  ['probabilidad', 'Probabilidad de hablar (0 a 1)', 0, 1, 0.05],
  ['filtro', 'Intensidad del filtro robótico', 0, 1, 0.05],
  ['tono', 'Tono (1 = el grabado)', 0.85, 1.3, 0.01],
  ['volumen', 'Volumen', 0.2, 4, 0.05],
  ['perdido', 'Segundos sin verte para «buscando»', 1, 15, 0.5],
];

const round = (v: number, step: number) => +(Math.round(v / step) * step).toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0);

export class DroidVoiceTuner {
  private root: HTMLDivElement;
  private inputs: Array<{ range: HTMLInputElement; num: HTMLElement; key: DroidVoiceKey; step: number }> = [];

  constructor(hooks: DroidVoiceTunerHooks) {
    const d = document.createElement('div');
    d.id = 'droidVoiceTuner';
    d.className = 'tuner';
    d.hidden = true;
    d.innerHTML = `
      <div class="ht-head"><b>VOCES DE LOS DROIDES</b><button data-a="close">✕</button></div>
      <div class="ht-fields"></div>
      <div class="ht-sub">PROBAR (POR LA IZQUIERDA)</div>
      <div class="ht-seg"><button data-p="near">A 3 m</button><button data-p="far">A la distancia máxima</button></div>
      <div class="ht-seg"><button data-a="copy" class="ht-copy">Copiar valores</button></div>
      <textarea class="ht-out" readonly hidden></textarea>`;
    document.body.appendChild(d);
    this.root = d;
    const box = d.querySelector('.ht-fields')!;
    for (const [key, label, min, max, step] of FIELDS) {
      const row = document.createElement('label');
      row.className = 'ht-row';
      row.innerHTML = `<span>${label} <i></i></span><input type="range" min="${min}" max="${max}" step="${step}">`;
      const range = row.querySelector('input')!, num = row.querySelector('i')!;
      range.addEventListener('input', () => {
        DROID_VOICE[key] = Number(range.value);
        num.textContent = String(round(Number(range.value), step));
      });
      box.appendChild(row);
      this.inputs.push({ range, num, key, step });
    }
    d.querySelectorAll<HTMLButtonElement>('[data-p]').forEach((b) => b.addEventListener('click', () => hooks.test(b.dataset.p === 'near' ? 3 : DROID_VOICE.distancia)));
    d.querySelector('[data-a="close"]')!.addEventListener('click', () => this.hide());
    d.querySelector('[data-a="copy"]')!.addEventListener('click', (e) => this.copy(e.currentTarget as HTMLButtonElement));
    for (const ev of ['pointerdown', 'touchstart', 'mousedown', 'click']) d.addEventListener(ev, (e) => e.stopPropagation());
  }

  private refresh() {
    for (const i of this.inputs) { i.range.value = String(DROID_VOICE[i.key]); i.num.textContent = String(round(DROID_VOICE[i.key], i.step)); }
  }

  private copy(btn: HTMLButtonElement) {
    const text = 'VOCES DROIDES ' + JSON.stringify(Object.fromEntries(FIELDS.map(([k, , , , step]) => [k, round(DROID_VOICE[k], step)])));
    const out = this.root.querySelector<HTMLTextAreaElement>('.ht-out')!;
    out.value = text;
    const done = () => { btn.textContent = 'Copiado ✓'; setTimeout(() => (btn.textContent = 'Copiar valores'), 1800); };
    const fallback = () => { out.hidden = false; out.focus(); out.select(); btn.textContent = 'Selecciona y copia el texto'; };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  show() { this.refresh(); this.root.hidden = false; }
  hide() { this.root.hidden = true; }
}
