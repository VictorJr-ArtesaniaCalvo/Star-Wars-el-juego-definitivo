import type { Quality, Settings } from '../core/Settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Menú de inicio y de pausa, con los ajustes.
export class Menu {
  private root = $('menu');
  private sub = $('menuSub');
  private btnPlay = $<HTMLButtonElement>('btnPlay');
  private help = $('help');

  constructor(settings: Settings, onPlay: () => void) {
    this.btnPlay.addEventListener('click', onPlay);
    this.bindAssist(settings);

    const sens = $<HTMLInputElement>('sens');
    const sensVal = $('sensVal');
    const showSens = () => (sensVal.textContent = Number(sens.value).toFixed(1));
    sens.value = String(settings.data.sensitivity);
    showSens();
    sens.addEventListener('input', () => {
      showSens();
      settings.set({ sensitivity: Number(sens.value) });
    });

    const qButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#quality button'));
    const showQ = () => qButtons.forEach((b) => b.classList.toggle('on', b.dataset.q === settings.data.quality));
    showQ();
    qButtons.forEach((b) =>
      b.addEventListener('click', () => {
        settings.set({ quality: b.dataset.q as Quality });
        showQ();
      }),
    );
  }

  private bindAssist(settings: Settings) {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#assist button'));
    const show = () => buttons.forEach((b) => b.classList.toggle('on', (b.dataset.a === '1') === settings.data.aimAssist));
    show();
    buttons.forEach((b) =>
      b.addEventListener('click', () => {
        settings.set({ aimAssist: b.dataset.a === '1' });
        show();
      }),
    );
  }

  ready() {
    $('loading').hidden = true;
    this.btnPlay.hidden = false;
    $('settings').hidden = false;
  }

  error(msg: string) {
    $('loading').textContent = msg;
  }

  setHelp(text: string) {
    this.help.textContent = text;
  }

  show(paused: boolean) {
    this.sub.textContent = paused ? 'EN PAUSA' : 'ÚLTIMA DEFENSA';
    this.btnPlay.textContent = paused ? 'CONTINUAR' : 'JUGAR';
    this.root.hidden = false;
  }

  hide() {
    this.root.hidden = true;
  }
}
