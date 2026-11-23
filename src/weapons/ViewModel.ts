import * as THREE from 'three';

// El bláster que se ve en pantalla (modelo provisional). Va pegado a la cámara.
export class ViewModel {
  readonly group = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  private body: THREE.MeshLambertMaterial;
  private kick = 0;
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
  }

  shot() { this.kick = 1; }

  update(dt: number, heat: number) {
    this.kick = Math.max(0, this.kick - dt * 9);
    this.group.position.z = -0.5 + this.kick * 0.05;
    this.group.rotation.x = this.kick * 0.07;
    // El arma se pone al rojo con el calor.
    this.body.emissive.copy(this.cold).lerp(this.hot, Math.max(0, heat - 0.35) / 0.65);
  }
}
