import * as THREE from 'three';

// Mínimo de luz en las caras que quedan a contraluz: al color de cada material se le suma un poco de luz cálida (el rebote del suelo naranja),
// así nada se queda negro puro y se sigue viendo la textura en las sombras. Cuesta una suma por pixel.
export const LIGHT_FLOOR = { value: new THREE.Color(0.1, 0.066, 0.05) };

export function withLightFloor<T extends THREE.Material>(mat: T): T {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.uniforms.uLightFloor = LIGHT_FLOOR;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLightFloor;')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  reflectedLight.indirectDiffuse += uLightFloor * diffuseColor.rgb;');
  };
  mat.customProgramCacheKey = () => prevKey.call(mat) + '+lf';
  return mat;
}
