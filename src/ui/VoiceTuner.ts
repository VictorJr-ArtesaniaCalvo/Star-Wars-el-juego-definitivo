import { RADIO_FILTERS, type FilterSetup, type VoiceFilter } from '../audio/Voices';

// Panel del modo de pruebas para ajustar en directo el filtro de radio de las voces de la cinemática y escucharlo.
// Dos filtros: «radio» (tomas 2A y 2B, más marcado) y «casco» (toma 5, más suave). «Copiar valores» copia los números para
// pasárselos al desarrollador, que los deja fijos en RADIO_FILTERS (src/audio/Voices.ts).

export interface VoiceTunerHooks {
  /** El filtro ha cambiado: hay que volver a montarlo. */
  retune: () => void;
  /** Reproduce una frase con su filtro (soldado y comandante: radio; comando: casco) o el golpe al casco con la ráfaga de estática. */
  play: (what: 'soldado' | 'comandante' | 'comando' | 'golpe') => void;
}

const FIELDS: Array<[keyof FilterSetup, string, number, number, number]> = [
  ['graves', 'Corte de graves (Hz)', 80, 1500, 10],
  ['agudos', 'Corte de agudos (Hz)', 1500, 9000, 50],
  ['medios', 'Realce de medios (metálico, dB)', 0, 18, 0.5],
  ['saturacion', 'Distorsión', 1, 10, 0.1],
  ['compresion', 'Compresión', 1, 20, 0.5],
  ['estatica', 'Estática de fondo', 0, 0.25, 0.005],
  ['clic', 'Clic de la radio', 0, 2, 0.05],
  ['volumen', 'Volumen de la voz', 0.2, 2.5, 0.05],
];

const round = (v: number, step: number) => +(Math.round(v / step) * step).toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0);

export class VoiceTuner {
  private root: HTMLDivElement;
  private kind: VoiceFilter = 'radio';
  private inputs: Array<{ range: HTMLInputElement; num: HTMLElement; key: keyof FilterSetup; step: number }> = [];

  constructor(hooks: VoiceTunerHooks) {
    const d = document.createElement('div');
    d.id = 'voiceTuner';
    d.className = 'tuner';
    d.hidden = true;
    d.innerHTML = `
      <div class="ht-head"><b>FILTRO DE RADIO</b><button data-a="close">✕</button></div>
      <div class="ht-seg"><button data-k="radio">Radio (2A y 2B)</button><button data-k="casco">Casco (toma 5)</button></div>
      <div class="ht-fields"></div>
      <div class="ht-sub">ESCUCHAR</div>
      <div class="ht-seg"><button data-p="soldado">Soldado</button><button data-p="comandante">Comandante</button></div>
      <div class="ht-seg"><button data-p="comando">Comando</button><button data-p="golpe">Golpe + estática</button></div>
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
        RADIO_FILTERS[this.kind][key] = Number(range.value);
        num.textContent = String(round(Number(range.value), step));
        hooks.retune();
      });
      box.appendChild(row);
      this.inputs.push({ range, num, key, step });
    }
    d.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.addEventListener('click', () => { this.kind = b.dataset.k as VoiceFilter; this.refresh(); }));
    d.querySelectorAll<HTMLButtonElement>('[data-p]').forEach((b) => b.addEventListener('click', () => {
      const p = b.dataset.p as 'soldado' | 'comandante' | 'comando' | 'golpe';
      // al probar una frase, el panel pasa a su filtro
      const k: VoiceFilter = p === 'comando' || p === 'golpe' ? 'casco' : 'radio';
      if (k !== this.kind) { this.kind = k; this.refresh(); }
      hooks.play(p);
    }));
    d.querySelector('[data-a="close"]')!.addEventListener('click', () => this.hide());
    d.querySelector('[data-a="copy"]')!.addEventListener('click', (e) => this.copy(e.currentTarget as HTMLButtonElement));
    for (const ev of ['pointerdown', 'touchstart', 'mousedown', 'click']) d.addEventListener(ev, (e) => e.stopPropagation());
  }

  private refresh() {
    this.root.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.classList.toggle('on', b.dataset.k === this.kind));
    const f = RADIO_FILTERS[this.kind];
    for (const i of this.inputs) { i.range.value = String(f[i.key]); i.num.textContent = String(round(f[i.key], i.step)); }
  }

  private copy(btn: HTMLButtonElement) {
    const pack = (f: FilterSetup) => Object.fromEntries(FIELDS.map(([k, , , , step]) => [k, round(f[k], step)]));
    const text = 'FILTRO ' + JSON.stringify({ radio: pack(RADIO_FILTERS.radio), casco: pack(RADIO_FILTERS.casco) });
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
