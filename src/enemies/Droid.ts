import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { EnemyState } from '../sim/types';
import { terrainHeight } from '../world/terrain';

const TAN = 0xc9b48c;
const HEIGHT = 1.9;

/** Droide de combate B1 (modelo provisional hecho con cajas). */
function b1Model(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.castShadow = true;
    g.add(m);
  };
  box(0.09, 0.85, 0.09, -0.13, 0.43, 0); // piernas
  box(0.09, 0.85, 0.09, 0.13, 0.43, 0);
  box(0.34, 0.14, 0.16, 0, 0.9, 0); // cadera
  box(0.3, 0.5, 0.18, 0, 1.2, 0); // torso
  box(0.26, 0.4, 0.12, 0, 1.25, 0.14); // mochila
  box(0.07, 0.6, 0.07, -0.23, 1.15, -0.08, 0.5); // brazos (sujetando el arma)
  box(0.07, 0.6, 0.07, 0.23, 1.15, -0.08, 0.5);
  box(0.06, 0.06, 0.5, 0.12, 1.0, -0.42); // bláster
  box(0.06, 0.22, 0.06, 0, 1.55, 0); // cuello
  box(0.13, 0.13, 0.42, 0, 1.72, -0.1, 0.35); // cabeza alargada
  return g;
}

// Un droide: su aspecto, su cuerpo sólido (para recibir disparos) y su estado.
export class Droid {
  readonly group: THREE.Group;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private mat = new THREE.MeshLambertMaterial({ color: TAN });
  private flash = 0;
  private deadTime = 0;
  private t = Math.random() * 10;
  private anchorX: number;
  /** Si es false, el droide se queda quieto (para pruebas). */
  patrol = true;

  constructor(
    scene: THREE.Scene,
    rapier: typeof RAPIER,
    physics: RAPIER.World,
    public state: EnemyState,
  ) {
    this.group = b1Model(this.mat);
    scene.add(this.group);
    this.anchorX = state.x;
    this.body = physics.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased());
    this.collider = physics.createCollider(rapier.ColliderDesc.capsule(HEIGHT / 2 - 0.28, 0.28), this.body);
    this.place();
    this.body.setTranslation({ x: state.x, y: state.y + HEIGHT / 2, z: state.z }, true);
  }

  /** Punto al que conviene apuntar (el pecho). */
  aimPoint(out: THREE.Vector3) {
    return out.set(this.state.x, this.state.y + 1.25, this.state.z);
  }

  private place() {
    const s = this.state;
    s.y = terrainHeight(s.x, s.z);
    this.group.position.set(s.x, s.y, s.z);
    this.group.rotation.y = s.yaw;
    this.body.setNextKinematicTranslation({ x: s.x, y: s.y + HEIGHT / 2, z: s.z });
  }

  hit(damage: number) {
    if (!this.state.alive) return;
    this.state.health -= damage;
    this.flash = 1;
    if (this.state.health <= 0) {
      this.state.alive = false;
      this.deadTime = 0;
      this.collider.setEnabled(false);
    }
  }

  /** Vuelve a aparecer en otro sitio (solo para el droide de pruebas). */
  respawn(x: number, z: number, health: number) {
    const s = this.state;
    s.x = this.anchorX = x;
    s.z = z;
    s.health = health;
    s.alive = true;
    this.t = 0;
    this.group.rotation.set(0, 0, 0);
    this.collider.setEnabled(true);
    this.place();
    this.body.setTranslation({ x: s.x, y: s.y + HEIGHT / 2, z: s.z }, true);
  }

  /** Devuelve los segundos que lleva destruido (0 si sigue en pie). */
  update(dt: number): number {
    const s = this.state;
    this.flash = Math.max(0, this.flash - dt * 7);
    this.mat.emissive.setRGB(this.flash, this.flash * 0.8, this.flash * 0.6);

    if (!s.alive) {
      this.deadTime += dt;
      // Se desploma hacia atrás.
      this.group.rotation.x = Math.min(Math.PI / 2, this.deadTime * 5);
      this.group.position.y = s.y + Math.min(0.12, this.deadTime * 0.5);
      return this.deadTime;
    }

    // Comportamiento de pruebas: patrulla despacio de lado a lado.
    if (this.patrol) this.t += dt;
    const prev = s.x;
    s.x = this.anchorX + Math.sin(this.t * 0.45) * 5;
    s.yaw = s.x > prev ? -Math.PI / 2 : Math.PI / 2;
    this.place();
    // Balanceo al andar.
    this.group.rotation.z = Math.sin(this.t * 6) * 0.04;
    return 0;
  }
}
