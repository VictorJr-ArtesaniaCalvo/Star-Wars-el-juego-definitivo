import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { glowTexture } from '../world/atmosphere';

// Granadas: se lanzan en arco, rebotan en el suelo y las rocas, y explotan al acabar la mecha.
// La que vuela es una bola gris sencilla de 10 cm (color parecido al del detonador térmico de la mano) con una bombilla roja
// que parpadea cada vez más deprisa hasta explotar, con un halo rojo para que se vea de lejos.
export const GRENADE = {
  perGame: 4, // granadas por partida
  speed: 24.5, // m/s al lanzar
  lift: 4, // impulso hacia arriba al lanzar
  fuse: 2.683, // segundos hasta explotar: lo que dura el pitido de la grabación del detonador (public/audio/detonador-armado.mp3), así estalla a la vez que el audio
  radius: 7, // radio de la explosión (m)
  maxDamage: 130, // daño en el centro (un B1 aguanta 60)
  selfDamage: 45, // daño máximo que te haces a ti mismo
  cooldown: 0.7, // segundos entre lanzamientos
};

const GRAVITY = 20;
const BALL = 0.05; // radio de la granada (10 cm de diámetro)
const BALL_COLOR = 0x8c908f; // gris del detonador térmico
const BULB = { r: 0.018, on: 0xff3020, off: 0x2a0000, halo: 0.2 }; // bombilla roja: radio, brillo encendida/apagada, tamaño del halo
const BOUNCE = 0.45;
const FRICTION = 0.65;

interface Active {
  mesh: THREE.Group;
  bulb: THREE.MeshLambertMaterial;
  halo: THREE.Sprite;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number;
  /** número del pitido que suena desde esta granada (para moverlo con ella) */
  sound?: number;
  rest: boolean;
  active: boolean;
}

/** Lleva todas las granadas en el aire. La física es sencilla: movimiento en arco y rebote contra lo que haya delante. */
export class GrenadeSystem {
  private pool: Active[] = [];
  private tmp = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private physics: RAPIER.World,
    private ignoreBody: RAPIER.RigidBody,
    private onExplode: (at: THREE.Vector3) => void,
    private onBounce?: (at: THREE.Vector3) => void,
    /** Pitido de la granada armada: empieza al lanzarla y la sigue mientras vuela. */
    private sound?: { start: (at: THREE.Vector3) => number | undefined; move: (id: number, at: THREE.Vector3) => void; stop: (id: number) => void },
  ) {
    const geo = new THREE.SphereGeometry(BALL, 12, 8);
    const mat = new THREE.MeshLambertMaterial({ color: BALL_COLOR });
    const bulbGeo = new THREE.SphereGeometry(BULB.r, 8, 6);
    const glow = glowTexture();
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(geo, mat));
      // bombilla: media esfera roja que asoma del costado (cada granada lleva la suya: parpadean por separado)
      const bulb = new THREE.MeshLambertMaterial({ color: 0x6a1410, emissive: BULB.off });
      const bulbMesh = new THREE.Mesh(bulbGeo, bulb);
      bulbMesh.position.set(BALL - BULB.r * 0.35, 0, 0);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xff3020, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.75 }));
      halo.scale.setScalar(BULB.halo);
      halo.position.copy(bulbMesh.position).multiplyScalar(1.15);
      halo.visible = false;
      mesh.add(bulbMesh, halo);
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, bulb, halo, pos: new THREE.Vector3(), vel: new THREE.Vector3(), fuse: 0, rest: false, active: false });
    }
  }

  throwFrom(origin: THREE.Vector3, dir: THREE.Vector3) {
    const g = this.pool.find((x) => !x.active);
    if (!g) return;
    g.pos.copy(origin).addScaledVector(dir, 0.25);
    g.vel.copy(dir).multiplyScalar(GRENADE.speed);
    g.vel.y += GRENADE.lift;
    g.fuse = GRENADE.fuse;
    g.rest = false;
    g.active = true;
    g.mesh.visible = true;
    g.mesh.position.copy(g.pos);
    g.sound = this.sound?.start(g.pos);
  }

  clear() {
    for (const g of this.pool) {
      if (g.active && g.sound !== undefined) this.sound?.stop(g.sound);
      g.active = false; g.mesh.visible = false; g.sound = undefined;
    }
  }

  /** ¿Hay alguna granada en el aire? (para pruebas) */
  get inFlight() {
    return this.pool.filter((g) => g.active).length;
  }

  update(dt: number) {
    for (const g of this.pool) {
      if (!g.active) continue;
      g.fuse -= dt;
      if (g.fuse <= 0) {
        if (g.sound !== undefined) this.sound?.stop(g.sound); // (el pitido ya ha terminado: por si acaso)
        g.sound = undefined;
        g.active = false;
        g.mesh.visible = false;
        this.onExplode(this.tmp.copy(g.pos));
        continue;
      }
      if (!g.rest) {
        g.vel.y -= GRAVITY * dt;
        const step = g.vel.length() * dt;
        if (step > 1e-6) {
          const dir = this.tmp.copy(g.vel).normalize();
          const hit = this.physics.castRayAndGetNormal(
            new RAPIER.Ray(g.pos, dir), step + BALL, true, undefined, undefined, undefined, this.ignoreBody,
          );
          if (hit && hit.timeOfImpact <= step + BALL) {
            const travel = Math.max(0, hit.timeOfImpact - BALL);
            g.pos.addScaledVector(dir, travel);
            const n = hit.normal;
            const vn = g.vel.x * n.x + g.vel.y * n.y + g.vel.z * n.z;
            if (vn < 0) {
              if (vn < -2.5) this.onBounce?.(g.pos);
              g.vel.x -= (1 + BOUNCE) * vn * n.x;
              g.vel.y -= (1 + BOUNCE) * vn * n.y;
              g.vel.z -= (1 + BOUNCE) * vn * n.z;
              g.vel.x *= FRICTION; g.vel.z *= FRICTION;
            }
            // Si ya casi no se mueve sobre una superficie casi horizontal, se queda quieta.
            if (g.vel.length() < 1.4 && n.y > 0.6) { g.vel.set(0, 0, 0); g.rest = true; }
          } else {
            g.pos.addScaledVector(dir, step);
          }
        }
        g.mesh.rotation.x += dt * 9;
        g.mesh.rotation.z += dt * 6;
      }
      g.mesh.position.copy(g.pos);
      if (g.sound !== undefined && !g.rest) this.sound?.move(g.sound, g.pos);
      // La bombilla roja parpadea cada vez más rápido (con su halo).
      const blink = Math.sin((GRENADE.fuse - g.fuse) * (10 + (GRENADE.fuse - g.fuse) * 14)) > 0;
      g.bulb.emissive.setHex(blink ? BULB.on : BULB.off);
      g.halo.visible = blink;
    }
  }
}
