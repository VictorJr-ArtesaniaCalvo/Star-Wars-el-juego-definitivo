import * as THREE from 'three';

export const FOG_COLOR = 0xd98a58;
export const SUN_DIR = new THREE.Vector3(-0.62, 0.45, 0.5).normalize();

// Cielo anaranjado con sol, dibujado por código (ligero para el móvil).
export function buildSky(scene: THREE.Scene) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      horizon: { value: new THREE.Color(FOG_COLOR) },
      top: { value: new THREE.Color(0x8a4a3a) },
      sunDir: { value: SUN_DIR },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 horizon; uniform vec3 top; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(horizon, top, pow(h, 0.55));
        float s = max(dot(d, sunDir), 0.0);
        col += vec3(1.0, 0.75, 0.45) * (pow(s, 6.0) * 0.35 + pow(s, 60.0) * 0.5);
        col = mix(col, vec3(1.0, 0.93, 0.78), smoothstep(0.9985, 0.9992, s));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(380, 24, 12), mat);
  sky.frustumCulled = false;
  scene.add(sky);

  scene.fog = new THREE.Fog(FOG_COLOR, 22, 170);

  scene.add(new THREE.HemisphereLight(0xffdcb8, 0x8a4a30, 1.5));
  const sun = new THREE.DirectionalLight(0xffc48a, 2.4);
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -35;
  sc.right = sc.top = 35;
  sc.near = 1;
  sc.far = 160;
  sun.shadow.bias = -0.0015;
  scene.add(sun, sun.target);

  return { sky, sun };
}
