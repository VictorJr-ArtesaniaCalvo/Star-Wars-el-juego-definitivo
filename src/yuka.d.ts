// Yuka no trae tipos; aquí van solo las piezas que usamos.
declare module 'yuka' {
  export class Vector3 {
    x: number;
    y: number;
    z: number;
    constructor(x?: number, y?: number, z?: number);
    set(x: number, y: number, z: number): this;
  }
  export class GameEntity {
    position: Vector3;
    boundingRadius: number;
  }
  export class Vehicle extends GameEntity {
    maxSpeed: number;
    maxForce: number;
    velocity: Vector3;
    steering: { add(behavior: unknown): void };
    update(delta: number): this;
  }
  export class SeekBehavior {
    constructor(target?: Vector3);
    target: Vector3;
    weight: number;
  }
  export class ObstacleAvoidanceBehavior {
    constructor(obstacles: GameEntity[]);
    weight: number;
  }
}
