// Panel sencillo del modo de pruebas: deslizadores que cambian en directo los números de un objeto de ajustes, botones para probar
// y «Copiar valores» (para pasárselos al desarrollador, que los deja fijos en el código). Se usa para el sonido de las naves.

export interface ValuesTunerSetup<T extends Record<string, number>> {
  id: string;
  titulo: string;
  valores: T;
  campos: Array<[keyof T & string, string, number, number, number]>; // clave, texto, mínimo, máximo, paso
  /** Botones para probar: texto y qué hacen. */
  pruebas?: Array<[string, () => void]>;
  /** Prefijo del texto copiado. */
  copia: string;
  /** Algún valor ha cambiado (para aplicarlo en directo). */
  cambio?: () => void;
}

const round = (v: number, step: number) => +(Math.round(v / step) * step).toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0);

export class ValuesTuner<T extends Record<string, number>> {
  private root: HTMLDivElement;
  private inputs: Array<{ range: HTMLInputElement; num: HTMLElement; key: keyof T & string; step: number }> = [];

  constructor(private o: ValuesTunerSetup<T>) {
    const d = document.createElement('div');
    d.id = o.id;
    d.className = 'tuner';
    d.hidden = true;
    d.innerHTML = `
      <div class="ht-head"><b>${o.titulo}</b><button data-a="close">✕</button></div>
      <div class="ht-fields"></div>
      ${o.pruebas?.length ? `<div class="ht-sub">PROBAR</div><div class="ht-seg">${o.pruebas.map(([t], i) => `<button data-p="${i}">${t}</button>`).join('')}</div>` : ''}
      <div class="ht-seg"><button data-a="copy" class="ht-copy">Copiar valores</button></div>
      <textarea class="ht-out" readonly hidden></textarea>`;
    document.body.appendChild(d);
    this.root = d;
    const box = d.querySelector('.ht-fields')!;
    for (const [key, label, min, max, step] of o.campos) {
      const row = document.createElement('label');
      row.className = 'ht-row';
      row.innerHTML = `<span>${label} <i></i></span><input type="range" min="${min}" max="${max}" step="${step}">`;
      const range = row.querySelector('input')!, num = row.querySelector('i')!;
      range.addEventListener('input', () => {
        (o.valores as Record<string, number>)[key] = Number(range.value);
        num.textContent = String(round(Number(range.value), step));
        o.cambio?.();
      });
      box.appendChild(row);
      this.inputs.push({ range, num, key, step });
    }
    d.querySelectorAll<HTMLButtonElement>('[data-p]').forEach((b) => b.addEventListener('click', () => o.pruebas?.[Number(b.dataset.p)]?.[1]()));
    d.querySelector('[data-a="close"]')!.addEventListener('click', () => this.hide());
    d.querySelector('[data-a="copy"]')!.addEventListener('click', (e) => this.copy(e.currentTarget as HTMLButtonElement));
    for (const ev of ['pointerdown', 'touchstart', 'mousedown', 'click']) d.addEventListener(ev, (e) => e.stopPropagation());
  }

  private refresh() {
    for (const i of this.inputs) { const v = this.o.valores[i.key] as number; i.range.value = String(v); i.num.textContent = String(round(v, i.step)); }
  }

  private copy(btn: HTMLButtonElement) {
    const text = `${this.o.copia} ` + JSON.stringify(Object.fromEntries(this.o.campos.map(([k, , , , step]) => [k, round(this.o.valores[k] as number, step)])));
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
