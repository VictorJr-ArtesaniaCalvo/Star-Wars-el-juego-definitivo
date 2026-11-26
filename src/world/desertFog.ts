import * as THREE from 'three';

// NIEBLA DEL DESIERTO: la niebla sencilla de distancia de siempre + una capa más densa a ras de suelo que se aclara al subir.
// Es un degradado liso (sin ruido: no da grano) calculado en cada píxel con una fórmula exacta (la cantidad de polvo que atraviesa
// la mirada desde los ojos hasta lo que se ve). Sirve para todos los materiales del juego sin tocarlos: se cambian las piezas de
// sombreado de la niebla de Three.js.
//
// Cómo llegan los datos al sombreado: el juego usa un objeto `DesertFog` que Three.js trata como su niebla «exponencial» (así se
// enciende el camino nuevo del sombreado), y en su único número (`density`) van empaquetadas la distancia lejana (parte entera)
// y la cercana (decimales × 1000). En calidad Ultra se usa la niebla lineal de siempre (THREE.Fog) y todo queda como estaba.

/** Capa de polvo a ras de suelo: densidad junto al suelo (por metro), altura a la que se reduce a un tercio (m) y altura del suelo. */
export const GROUND_DUST = { density: 0.0075, height: 7, groundY: 0 };
/** Durante una ráfaga la niebla tapa algo más: lo lejano se acerca (`far`) y la niebla empieza antes (`near`). */
export const GUST_FOG = { far: 0.3, near: 0.55 };

const f = (v: number) => v.toFixed(5);

THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
	varying float vFogDepth;
	#ifdef FOG_EXP2
		varying vec3 vFogRel;
	#endif
#endif`;

THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	#ifdef FOG_EXP2
		vFogRel = transpose( mat3( viewMatrix ) ) * mvPosition.xyz; // del ojo al punto, en ejes del mundo
	#endif
#endif`;

THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
		varying vec3 vFogRel;
		#define fogFar floor( fogDensity )
		#define fogNear ( fract( fogDensity ) * 1000.0 )
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`;

THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		// distancia (como siempre) + polvo a ras de suelo atravesado por la mirada
		float fogDist = smoothstep( fogNear, fogFar, vFogDepth );
		float fogLen = length( vFogRel );
		float fogB = 1.0 / ${f(GROUND_DUST.height)};
		float fogK = fogB * vFogRel.y;
		float fogI = abs( fogK ) > 1e-3 ? ( 1.0 - exp( - fogK ) ) / fogK : 1.0 - 0.5 * fogK;
		float fogH = ${f(GROUND_DUST.density)} * exp( - fogB * ( cameraPosition.y - ${f(GROUND_DUST.groundY)} ) ) * fogLen * fogI;
		float fogFactor = 1.0 - ( 1.0 - fogDist ) * exp( - min( fogH, 6.0 ) );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;

/** La niebla del desierto (ver arriba). Se usa como `scene.fog`: `near`/`far` como en THREE.Fog; `gust` (0–1) la espesa en las ráfagas. */
export class DesertFog {
  readonly isFog = false;
  readonly isFogExp2 = true;
  name = 'DesertFog';
  color: THREE.Color;
  /** Fuerza de la ráfaga actual (0 = calma, 1 = máxima). */
  gust = 0;
  constructor(color: THREE.ColorRepresentation, public near: number, public far: number) {
    this.color = new THREE.Color(color);
  }
  /** Lo que lee Three.js: lejos (parte entera) y cerca (decimales × 1000), ya con la ráfaga aplicada. */
  get density() {
    const far = Math.max(2, Math.round(this.far * (1 - GUST_FOG.far * this.gust)));
    const near = Math.max(0, Math.min(far - 1, this.near * (1 - GUST_FOG.near * this.gust), 999));
    return far + Math.min(0.999, near / 1000);
  }
  clone() { const c = new DesertFog(this.color, this.near, this.far); c.gust = this.gust; return c; }
  toJSON() { return { type: 'DesertFog', name: this.name, color: this.color.getHex(), near: this.near, far: this.far }; }
}

/** Niebla de la escena (la del desierto o, en Ultra, la lineal de siempre). */
export type SceneFog = DesertFog | THREE.Fog;
