import * as THREE from 'three';

const BOLT_SPEED = 170; // m/s
const BOLT_LENGTH = 2.2;

interface Bolt { mesh: THREE.Mesh; dir: THREE.Vector3; left: number; active: boolean }
interface Flash { mesh: THREE.Mesh; life: number; active: boolean }

// Efectos visuales de los disparos: rayos y chispazo de impacto. Se reutilizan
// siempre los mismos objetos para no cargar el móvil.
export class Effects {
  private bolts: Bolt[] = [];
  private flashes: Flash[] = [];

  constructor(scene: THREE.Scene) {
    const boltGeo = new THREE.BoxGeometry(0.045, 0.045, BOLT_LENGTH);
    boltGeo.translate(0, 0, BOLT_LENGTH / 2);
    const boltMat = new THREE.MeshBasicMaterial({ color: 0x66b8ff, fog: false });
    for (let i = 0; i < 14; i++) {
      const mesh = new THREE.Mesh(boltGeo, boltMat);
      mesh.visible = false;
      scene.add(mesh);
      this.bolts.push({ mesh, dir: new THREE.Vector3(), left: 0, active: false });
    }
    const flashGeo = new THREE.IcosahedronGeometry(0.22, 0);
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(flashGeo, new THREE.MeshBasicMaterial({ color: 0xbfe2ff, transparent: true, fog: false }));
      mesh.visible = false;
      scene.add(mesh);
      this.flashes.push({ mesh, life: 0, active: false });
    }
  }

  /** Lanza un rayo desde la boca del arma hasta el punto de impacto. */
  bolt(from: THREE.Vector3, to: THREE.Vector3) {
    const b = this.bolts.find((x) => !x.active) ?? this.bolts[0];
    b.dir.copy(to).sub(from);
    b.left = b.dir.length();
    b.dir.normalize();
    b.mesh.position.copy(from);
    b.mesh.lookAt(to);
    b.mesh.visible = true;
    b.active = true;
  }

  flash(at: THREE.Vector3) {
    const f = this.flashes.find((x) => !x.active) ?? this.flashes[0];
    f.mesh.position.copy(at);
    f.life = 1;
    f.active = true;
    f.mesh.visible = true;
  }

  update(dt: number) {
    for (const b of this.bolts) {
      if (!b.active) continue;
      const step = BOLT_SPEED * dt;
      b.left -= step;
      b.mesh.position.addScaledVector(b.dir, step);
      if (b.left <= 0) { b.active = false; b.mesh.visible = false; }
    }
    for (const f of this.flashes) {
      if (!f.active) continue;
      f.life -= dt * 6;
      if (f.life <= 0) { f.active = false; f.mesh.visible = false; continue; }
      f.mesh.scale.setScalar(1 + (1 - f.life) * 1.8);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = f.life;
    }
  }
}
