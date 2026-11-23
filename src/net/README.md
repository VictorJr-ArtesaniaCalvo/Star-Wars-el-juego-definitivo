# Red (reservado para el modo cooperativo)

Todavía vacío a propósito. Cuando llegue el cooperativo (servidor en el portátil vía Tailscale):

- `src/sim/` contiene el estado del juego (`GameState`) y las órdenes de cada jugador (`InputCommand`).
  Eso es lo que viajará entre los dos jugadores y el servidor.
- El mundo se genera con una "semilla" fija (`WORLD_SEED`), así ambos jugadores ven exactamente el mismo escenario
  sin tener que enviarlo por la red.
- `GameState.players` ya es una lista, para que añadir un segundo jugador no obligue a rehacer nada.
