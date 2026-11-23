# Geonosis: Última Defensa

Juego 3D de defensa por oleadas en primera persona para el navegador, instalable en el iPhone como app (PWA).
Proyecto personal y experimental.

## Estado

- **Fase 1 (hecha):** moverse en primera persona, agacharse, escenario y zona de defensa con coberturas.
- **Fase 2 (hecha):** bláster con sobrecalentamiento, droide B1 de prueba y ayuda al apuntar.
- Fase 3: oleadas. · Fase 4: granadas. · Fase 5: más enemigos. · Fase 6: mejoras visuales y sonido.

## Controles

| | Moverse | Mirar | Disparar | Agacharse | Pausa |
|---|---|---|---|---|---|
| Táctil | Joystick (mitad izquierda) | Deslizar (mitad derecha) | Botón (se puede apuntar sin soltarlo) | Botón | Botón II |
| Mando | Stick izquierdo | Stick derecho | RT / R2 | B / Círculo | Options / Menu |
| Teclado | WASD | Ratón o flechas | Clic o Espacio | C | P |

## Instalar en el iPhone

Abrir el enlace del juego en Safari → Compartir → «Añadir a pantalla de inicio». Así se ve a pantalla completa.

## Organización

- `src/core` arranque, bucle del juego, ajustes · `src/world` escenario · `src/player` jugador
- `src/input` controles · `src/ui` menús e indicadores · `src/sim` reglas del juego
- `src/weapons` bláster y efectos · `src/enemies` droides
- `src/net`, `src/waves`, `src/audio`: reservados para fases posteriores

## Para desarrollo

`npm install` · `npm run dev` (probar en local) · `npm run build` (generar la versión publicable).
Cada subida a GitHub publica el juego automáticamente en GitHub Pages.
