import * as THREE from 'three';

// Aspecto de los droides, sutil: metal con brillo suave (en calidad Media y Alta), aristas algo más claras por el desgaste, manchas muy suaves de uso y
// polvo rojizo de Geonosis en piernas y pies (más intenso cerca del suelo). Se añade al material de cada droide.
export const DROID_METAL = { value: 0.8 };
// el brillo metálico es un 20 % menor que en la primera versión (0,8 en vez de 1)
export const setDroidMetal = (on: boolean) => { DROID_METAL.value = on ? 0.8 : 0; };
const WEAR = { value: 1 }; // intensidad general (1 = la que se ve ahora; se puede subir)

export function withDroidWear<T extends THREE.Material>(mat: T): T {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.uniforms.uMetal = DROID_METAL;
    sh.uniforms.uWear = WEAR;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vDy;\nvarying vec3 vOp;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvDy = transformed.y;\nvOp = transformed;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vDy;\nvarying vec3 vOp;\nuniform float uMetal;\nuniform float uWear;')
      .replace('#include <map_fragment>', `#include <map_fragment>
  // polvo rojizo: más intenso cerca del suelo
  float dust = (1.0 - smoothstep(0.0, 0.85, vDy)) * 0.6 * uWear;
  // manchas muy suaves de desgaste
  float blot = fract(sin(dot(floor(vOp * 14.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  diffuseColor.rgb *= 1.0 - 0.07 * uWear * (blot - 0.5) * 2.0;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.29, 0.18), dust * 0.5);`)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  reflectedLight.directSpecular *= uMetal;')
      .replace('#include <opaque_fragment>', `float edgeW = smoothstep(0.12, 0.5, length(fwidth(normalize(vNormal))));
  outgoingLight += vec3(0.2, 0.17, 0.14) * edgeW * uWear * uMetal; // aristas más claras por el desgaste
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => prevKey.call(mat) + '+wear';
  return mat;
}
