import type { Quality, Settings } from '../core/Settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface MenuActions {
  onPlay: () => void;
  onQuit: () => void;
}

// Menú de inicio y de pausa, con los ajustes y el panel oculto de pruebas.
export class Menu {
  private root = $('menu');
  private sub = $('menuSub');
  private btnPlay = $<HTMLButtonElement>('btnPlay');
  private btnQuit = $<HTMLButtonElement>('btnQuit');
  private help = $('help');
  private testPanel = $('testPanel');

  constructor(private settings: Settings, actions: MenuActions) {
    this.btnPlay.addEventListener('click', actions.onPlay);
    this.btnQuit.addEventListener('click', actions.onQuit);

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

    this.bindToggle('#assist', 'a', () => settings.data.aimAssist, (v) => settings.set({ aimAssist: v }));
    this.bindToggle('#god', 'v', () => settings.data.invincible, (v) => settings.set({ invincible: v }));
    this.bindToggle('#fpsOpt', 'v', () => settings.data.showFps, (v) => settings.set({ showFps: v }));

    // Menú oculto: 5 toques seguidos sobre el título.
    let taps = 0, last = 0;
    $('title').addEventListener('click', () => {
      const now = performance.now();
      taps = now - last < 1500 ? taps + 1 : 1;
      last = now;
      if (taps >= 5) {
        taps = 0;
        this.testPanel.hidden = !this.testPanel.hidden;
      }
    });
    const roundVal = $('roundVal');
    const showRound = () => (roundVal.textContent = String(settings.data.testRound));
    showRound();
    $('roundMinus').addEventListener('click', () => { settings.set({ testRound: Math.max(1, settings.data.testRound - 1) }); showRound(); });
    $('roundPlus').addEventListener('click', () => { settings.set({ testRound: Math.min(60, settings.data.testRound + 1) }); showRound(); });
  }

  private bindToggle(sel: string, attr: string, get: () => boolean, set: (v: boolean) => void) {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(`${sel} button`));
    const show = () => buttons.forEach((b) => b.classList.toggle('on', (b.dataset[attr] === '1') === get()));
    show();
    buttons.forEach((b) =>
      b.addEventListener('click', () => {
        set(b.dataset[attr] === '1');
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
    this.btnQuit.hidden = !paused;
    const best = $('best');
    best.hidden = paused || this.settings.data.best < 1;
    best.textContent = `Mejor ronda: ${this.settings.data.best}`;
    this.root.hidden = false;
  }

  hide() {
    this.root.hidden = true;
  }
}
