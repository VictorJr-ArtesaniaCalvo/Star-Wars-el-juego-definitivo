// Ajustes del jugador. Se guardan en el propio dispositivo.
export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export interface SettingsData {
  sensitivity: number;
  quality: Quality;
  volume: number; // 0–1 (general)
  musicVolume: number; // 0–1
  sfxVolume: number; // 0–1 (efectos de sonido y ambiente)
  aimAssist: boolean; // ayuda al apuntar con controles táctiles
  best: number; // mejor ronda alcanzada (solo en partidas normales)
  // Modo de pruebas (menú oculto)
  testRound: number;
  invincible: boolean;
  showFps: boolean;
}

const KEY = 'geonosis.settings.v1';
const DEFAULTS: SettingsData = {
  sensitivity: 1,
  quality: 'medium',
  volume: 0.8,
  musicVolume: 0.5,
  sfxVolume: 1,
  aimAssist: true,
  best: 0,
  testRound: 1,
  invincible: false,
  showFps: false,
};

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
  low: { pixelRatio: 1, shadows: false, shadowSize: 1024, viewDistance: 115, bloom: false },
  medium: { pixelRatio: 1.5, shadows: false, shadowSize: 1024, viewDistance: 150, bloom: false },
  high: { pixelRatio: 2, shadows: true, shadowSize: 1024, viewDistance: 190, bloom: false },
  // Ultra: sombras más nítidas, resplandor en las luces fuertes (bloom) y la máxima resolución. Pesa bastante: se puede quitar.
  ultra: { pixelRatio: 3, shadows: true, shadowSize: 2048, viewDistance: 230, bloom: true },
} as const;
