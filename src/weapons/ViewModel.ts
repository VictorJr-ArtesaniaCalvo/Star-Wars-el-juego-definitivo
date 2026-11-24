import * as THREE from 'three';

// El bláster que se ve en pantalla (modelo provisional). Va pegado a la cámara.
export class ViewModel {
  readonly group = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  private body: THREE.MeshLambertMaterial;
  private kick = 0;
  private grenade = new THREE.Group();
  private bRaise = 1; // 0 = guardada, 1 = en la mano
  private gRaise = 0;
  private throwT = 0;
  private cold = new THREE.Color(0x000000);
  private hot = new THREE.Color(0x9a2408);

  constructor(camera: THREE.Camera) {
    this.body = new THREE.MeshLambertMaterial({ color: 0x3b3f45, fog: false });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1d1f22, fog: false });
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      this.group.add(mesh);
    };
    box(0.06, 0.08, 0.34, 0, 0, 0, this.body); // cuerpo
    box(0.035, 0.035, 0.22, 0, 0.012, -0.27, dark); // cañón
    box(0.045, 0.11, 0.06, 0, -0.085, 0.09, dark); // empuñadura
    box(0.03, 0.03, 0.12, 0, 0.055, -0.02, dark); // mira
    this.muzzle.position.set(0, 0.012, -0.4);
    this.group.add(this.muzzle);
    this.group.position.set(0.2, -0.19, -0.5);
    this.group.scale.setScalar(0.62);
    camera.add(this.group);

    // Granada en la mano: esfera verde con la anilla
    const gm = new THREE.MeshLambertMaterial({ color: 0x4d5a3c, fog: false });
    const gs = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), gm);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8), new THREE.MeshLambertMaterial({ color: 0x2b2f26, fog: false }));
    cap.position.y = 0.085;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 12), new THREE.MeshLambertMaterial({ color: 0xb9b9b0, fog: false }));
    ring.position.set(0.04, 0.1, 0);
    this.grenade.add(gs, cap, ring);
    this.grenade.visible = false;
    this.grenade.scale.setScalar(0.7);
    camera.add(this.grenade);
  }

  /** Animación de lanzamiento: la granada sale disparada hacia delante. */
  throwAnim() { this.throwT = 1; }

  shot() { this.kick = 1; }

  /** `zoom` va de 0 (desde la cadera) a 1 (apuntando): el arma se centra y baja un poco. */
  update(dt: number, heat: number, zoom = 0, weapon: 'blaster' | 'grenade' = 'blaster') {
    this.kick = Math.max(0, this.kick - dt * 9);
    // Se guarda un arma bajándola y se saca la otra subiéndola
    const k = Math.min(1, dt * 11);
    this.bRaise += ((weapon === 'blaster' ? 1 : 0) - this.bRaise) * k;
    this.gRaise += ((weapon === 'grenade' ? 1 : 0) - this.gRaise) * k;
    this.throwT = Math.max(0, this.throwT - dt * 5);
    this.group.visible = this.bRaise > 0.04;
    this.grenade.visible = this.gRaise > 0.04 || this.throwT > 0;
    this.grenade.position.set(0.15, -0.17 - (1 - this.gRaise) * 0.3 + this.throwT * 0.05, -0.36 - this.throwT * 0.5);
    this.grenade.rotation.x = this.throwT * 1.2;
    zoom = zoom * this.bRaise;
    this.group.position.x = 0.2 * (1 - zoom * 0.9);
    this.group.position.y = -0.19 + zoom * 0.045 - (1 - this.bRaise) * 0.3;
    this.group.position.z = -0.5 + this.kick * 0.05 * (1 - zoom * 0.5);
    this.group.rotation.x = this.kick * 0.07;
    // El arma se pone al rojo con el calor.
    this.body.emissive.copy(this.cold).lerp(this.hot, Math.max(0, heat - 0.35) / 0.65);
  }
}
