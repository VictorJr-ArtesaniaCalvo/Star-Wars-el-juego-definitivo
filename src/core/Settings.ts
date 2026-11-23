// Ajustes del jugador. Se guardan en el propio dispositivo.
export type Quality = 'low' | 'medium' | 'high';

export interface SettingsData {
  sensitivity: number;
  quality: Quality;
}

const KEY = 'geonosis.settings.v1';
const DEFAULTS: SettingsData = { sensitivity: 1, quality: 'medium' };

export class Settings {
  data: SettingsData = { ...DEFAULTS };
  private listeners: Array<(d: SettingsData) => void> = [];

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      /* sin almacenamiento disponible: se usan los valores por defecto */
    }
  }

  set(patch: Partial<SettingsData>) {
    this.data = { ...this.data, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignorar */
    }
    for (const l of this.listeners) l(this.data);
  }

  onChange(l: (d: SettingsData) => void) {
    this.listeners.push(l);
  }
}

// Qué significa cada nivel de calidad.
export const QUALITY = {
  low: { pixelRatio: 1, shadows: false, viewDistance: 130 },
  medium: { pixelRatio: 1.5, shadows: false, viewDistance: 170 },
  high: { pixelRatio: 2, shadows: true, viewDistance: 210 },
} as const;
