// THE SEAM - ZURICH. The placed bank as an instrument.
// Parts rest at their surveyed positions; MIDI notes or clicks strike them;
// each part is a damped spring on the sky-ground axis, weakly coupled to its
// neighbours, so the installation never breaks - it waves.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water as Water2 } from 'three/addons/objects/Water2.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

window.__SEAMV = '1788112775';
// QUALITY TIERS (Dele 2026-08-30): LOW is the default and must run on
// laptops and phones; HIGH is the full installation render, one click away.
// default tier (Dele): phones and laptops LOW, desktops HIGH. A browser
// cannot know the chassis, but the GPU name can: discrete desktop cards
// say GeForce/RTX/Radeon RX; laptop variants say Laptop/Max-Q; integrated
// and Apple silicon read as laptops. An explicit button choice always wins.
let QUALITY = null;
try { QUALITY = localStorage.getItem('seamQuality'); } catch (e) {}
if (!QUALITY && new URLSearchParams(location.search).get('tier') === 'low') {
  QUALITY = 'low';
}
const AUTO_TIER = !QUALITY;
if (!QUALITY) {
  let gpu = '';
  try {
    const probe = document.createElement('canvas').getContext('webgl2');
    const ext = probe && probe.getExtension('WEBGL_debug_renderer_info');
    if (ext) gpu = String(probe.getParameter(ext.UNMASKED_RENDERER_WEBGL));
  } catch (e) {}
  const mobileUA = /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 2 && screen.width < 1100);
  const desktopGPU = /GeForce|RTX \d|GTX \d|Radeon RX|Radeon PRO W|Arc A\d/i.test(gpu) &&
    !/laptop|mobile|max-q/i.test(gpu);
  QUALITY = (!mobileUA && desktopGPU) ? 'high' : 'low';
  console.log('auto tier:', QUALITY, '(gpu: ' + gpu + ')');
}
const HI = QUALITY === 'high';

// ---------------------------------------------------------------- scene --
const canvas = document.getElementById('c');
// a gallery machine running for days must survive a lost GL context
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  setTimeout(() => location.reload(), 1200);
});
// ?kiosk=1 - exhibition mode: no chrome, auto-enter after assembly
const KIOSK = new URLSearchParams(location.search).get('kiosk') === '1';
if (KIOSK) document.documentElement.classList.add('kiosk');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(HI ? 2 : 1.25);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.76;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
// our data is Z-up; three is Y-up. One group rotation solves it forever.
const world = new THREE.Group();
world.rotation.x = -Math.PI / 2;
scene.add(world);

// FIXED CAMERA - Dele's own frame, read from camera.json (extracted from
// his C4D export). No orbit, no tour: the piece is seen as he framed it.
const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 6000);
let sunAz = THREE.MathUtils.degToRad(55);
const sunFocus = new THREE.Vector3();
// bank geometry - needed by water, light and shadows whatever camera runs
const bank = { mid: [0, 0, 0], ang: 0, cross: 60, zlow: 0, radius: 300 };
async function readBank() {
  const man = await (await fetch('./manifest.json')).json();
  const o = man.map((r) => r.origin);
  const mid = o.reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
                       [0, 0, 0]).map((v) => v / o.length);
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of o) {
    const dx = p[0] - mid[0], dy = p[1] - mid[1];
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  bank.ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ax = [Math.cos(bank.ang), Math.sin(bank.ang)];
  let cross = 0, radius = 0;
  for (const p of o) {
    const dx = p[0] - mid[0], dy = p[1] - mid[1];
    cross = Math.max(cross, Math.abs(-ax[1] * dx + ax[0] * dy));
    radius = Math.max(radius, Math.hypot(dx, dy));
  }
  bank.mid = mid; bank.cross = cross; bank.radius = radius;
  bank.zlow = Math.min(...o.map((p) => p[2]));
}
async function setUpCamera() {
try {
  const camSpec = await (await fetch('./camera.json')).json();
  bank.lookX = camSpec.target[0];   // the channel passes under his gaze
  camera.fov = camSpec.fov;
  camera.position.set(...camSpec.position);
  camera.up.set(...(camSpec.up || [0, 1, 0]));
  camera.lookAt(new THREE.Vector3(...camSpec.target));
} catch (e) {
  const ax = [Math.cos(bank.ang), Math.sin(bank.ang)];
  const h = Math.max(120, bank.cross * 1.85);
  camera.fov = 40; camera.updateProjectionMatrix();
  camera.position.set(bank.mid[0], bank.mid[2] + h, -bank.mid[1]);
  camera.up.set(-ax[1], 0, -ax[0]);
  camera.lookAt(bank.mid[0], bank.mid[2], -bank.mid[1]);
}
}

const sky = new Sky();
sky.scale.setScalar(50000);
scene.add(sky);
const sunDir = new THREE.Vector3().setFromSphericalCoords(
  1, THREE.MathUtils.degToRad(68), THREE.MathUtils.degToRad(55));
sky.material.uniforms.sunPosition.value.copy(sunDir);
sky.material.uniforms.turbidity.value = 6;
sky.material.uniforms.rayleigh.value = 1.6;
// fog off for the top-down installation view - it only washed the banks

// warm low sun with REAL shadows - the terracing lives in them
const sun = new THREE.DirectionalLight(0xffc98a, 6.0);
sun.position.copy(sunDir).multiplyScalar(600);
sun.castShadow = true;
sun.shadow.mapSize.set(HI ? 8192 : 2048, HI ? 8192 : 2048);
sun.shadow.bias = -0.0004;
const hemi = new THREE.HemisphereLight(0xbfd0e4, 0x3c382e, 0.3);
scene.add(sun, hemi);

// WEATHER (Dele 2026-08-30): rain, lightning, fog - summoned by the songs.
scene.fog = new THREE.FogExp2(0xb8c2ca, 0.0);   // density driven by mood
const fogColor = scene.fog.color;
const rain = (() => {
  // POURING rain (Dele: "make it pour") - long slanted streaks, dense and
  // fast; 1 m whisper lines were invisible from 100 m up
  const N = HI ? 6000 : 3000, pos = new Float32Array(N * 6), vel = new Float32Array(N);
  const lens = new Float32Array(N);
  const SLANT = 0.22;   // wind lean, x per unit of length
  for (let i = 0; i < N; i++) {
    const x = -124 + (Math.random() - 0.5) * 360;
    const y = Math.random() * 160;
    const z = 36 + (Math.random() - 0.5) * 360;
    lens[i] = 4.5 + Math.random() * 4.5;
    pos.set([x, y, z, x + lens[i] * SLANT, y + lens[i], z], i * 6);
    vel[i] = 65 + Math.random() * 35;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
    color: 0xe8f2f4, transparent: true, opacity: 0, depthWrite: false }));
  m.frustumCulled = false; m.visible = false;
  scene.add(m);
  m.userData.vel = vel; m.userData.lens = lens; m.userData.slant = SLANT;
  return m;
})();
let flashT = 0;

// (splash effect removed - Dele 2026-08-30: it read as a childish disc)


// THE RIVER, take two (Dele 2026-08-30): three.js Water2 - the flow-map
// water from Portal 2's lineage. Reflection AND true refraction: what is
// under the surface is rendered THROUGH it, so the sand and the drowned
// terraces show as real transparency, not an alpha trick. Two normal maps
// advected in counter-phase carry the flow.
const water = new Water2(new THREE.PlaneGeometry(12000, 12000), {
  color: 0xb2ded6,
  clipBias: 0.1,   // pushes the refraction clip past the waterline - kills the edge flicker
  textureWidth: HI ? 1024 : 512, textureHeight: HI ? 1024 : 512,
  flowDirection: new THREE.Vector2(0, 1),   // corrected after camera setup
  flowSpeed: 0,   // the song drives the speed from tick(); internal update adds zero
  reflectivity: 0.10,
  scale: 850,
  normalMap0: new THREE.TextureLoader().load('./tex/Water_1_M_Normal.jpg',
    (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; }),
  normalMap1: new THREE.TextureLoader().load('./tex/Water_2_M_Normal.jpg',
    (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; }),
});
water.rotation.x = -Math.PI / 2;
scene.add(water);   // height set after the manifest loads
// THE DEEP: a second, murky, motionless water at the true datum (y = 0),
// far below the glassy river - seen through it, the channel gains depth,
// an empty dark space hanging between the two surfaces
const deepWater = new THREE.Mesh(
  new THREE.PlaneGeometry(12000, 12000),
  new THREE.MeshStandardMaterial({ color: 0x12897a, roughness: 0.92,
    metalness: 0.0, envMapIntensity: 0.35 }));
deepWater.rotation.x = -Math.PI / 2;
deepWater.position.y = 2.5;   // the scattering ground: refraction shows THIS
                              // turquoise through the surface (the print's colour)
deepWater.receiveShadow = true;
scene.add(deepWater);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(sky).texture;
await readBank();
await setUpCamera();
// water height, flow alignment, shadow frame - from the bank, always
const waterBaseY = 7.95;   // JUST below the sand banks (measured: sand p2-p15 = 8.0-8.8 m) - Dele 2026-08-30
water.position.y = waterBaseY;
let musicEnergy = 0;
let levelTarget = waterBaseY;   // LOCKED per song - set only at song change
// waterline uniform shared by every block material - foam + wet band
const waterUni = { value: waterBaseY };
const waterClock = { value: 0 };
// (foam removed - Dele 2026-08-30: river water only)

// FLOW: the drift lives in the shader's noise, not the plane - inject a
// direction uniform aimed up Dele's frame (screen-up projected onto water)
const upw = camera.up.clone();
const fu = upw.x, fv = -upw.z;
const fl = Math.hypot(fu, fv) || 1;
const flowDir = new THREE.Vector2(fu / fl, fv / fl);
// aim the flow up Dele's frame, and take the flow clock into our own
// hands so each song can set the river's speed (Water2's internal update
// uses a fixed closure speed)
water.material.uniforms['flowDirection'].value.copy(flowDir).multiplyScalar(-1);   // Dele: it flowed the wrong way
// SUN GLITTER: Water2 has no direct sun - a Blinn sparkle on the perturbed
// normal restores the print's glinting path. Anchors verified against the
// r168 Water2 source.
water.material.onBeforeCompile = (sh) => {
  sh.uniforms.sunDirW = { value: new THREE.Vector3(0, 1, 0) };
  sh.uniforms.sunColW = { value: new THREE.Color(0xffffff) };
  sh.uniforms.glint = { value: 0.6 };
  water.userData.glintU = sh.uniforms;
  sh.fragmentShader = sh.fragmentShader
    .replace('uniform float reflectivity;',
      'uniform float reflectivity;\nuniform vec3 sunDirW;\nuniform vec3 sunColW;\nuniform float glint;')
    .replace('gl_FragColor = vec4( color, 1.0 ) * mix( refractColor, reflectColor, reflectance );',
      'gl_FragColor = vec4( color, 1.0 ) * mix( refractColor, reflectColor, reflectance );\n' +
      'vec3 hw = normalize( toEye + sunDirW );\n' +
      'float sparkle = pow( max( dot( normal, hw ), 0.0 ), 240.0 );\n' +
      'gl_FragColor.rgb += sunColW * sparkle * glint;');
};
water.material.needsUpdate = true;
// stock 0.15 cycle - a bigger cycle made the crossfade read as the water
// jumping back (Dele: 'it stutters'). The flow feel he approved in faehre
// comes from SPEED, not cycle length; the floor below gives it to all songs.
// NOTE: Water2's own onBeforeRender must stay - it renders the
// reflection and refraction targets. flowSpeed 0 makes its internal flow
// advance a no-op; tick() adds the song's speed to `config` directly.

sunFocus.set(bank.mid[0], bank.mid[2], -bank.mid[1]);
const ss = bank.radius + 60;
sun.shadow.camera.left = -ss; sun.shadow.camera.right = ss;
sun.shadow.camera.top = ss; sun.shadow.camera.bottom = -ss;
sun.shadow.camera.far = 2000;
sun.target.position.copy(sunFocus);
scene.add(sun.target);
sun.shadow.camera.updateProjectionMatrix();

// state-of-the-art shading: GTAO contact occlusion between the strips
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
gtao.blendIntensity = 0.9;
composer.addPass(gtao);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------- parts --
// spring state per part: y offset, velocity; struck by notes and clicks
const parts = [];            // { mesh, rest(Vector3 world), y, v, order }
const byOrder = [];
let K = 22, DAMP = 4.2;
const COUPLE = 2.4, MAXY = 1.8;

const manifest = await (await fetch('./manifest.json')).json();
document.title = 'kleinbasel';
document.getElementById('title').textContent = 'KLEIN BASEL — ODDVIZ';
const loader = new GLTFLoader();
// LOW loads ETC1S/KTX2-compressed parts: ~6x less texture VRAM, GPU-native
const ktx2 = new KTX2Loader()
  .setTranscoderPath('./libs/basis/')
  .detectSupport(renderer);
loader.setKTX2Loader(ktx2);
const PARTS_DIR = HI ? 'parts' : 'parts_ktx2';
// 4K texture override - the GLBs embed 2K; the masters have 16K to give
const texLoader = new THREE.TextureLoader();
const hi = {};
for (const par of [...new Set(manifest.map((r) => r.parent))]) {
  const t = texLoader.load('./tex/' + par + '_4k.jpg');
  t.flipY = false; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  hi[par] = t;
}
let centroid = new THREE.Vector3();
const loadOne = (rec) => new Promise((res) => {
  loader.load(`./${PARTS_DIR}/${rec.name}.glb`, (g) => {
    const holder = new THREE.Group();
    holder.position.set(rec.origin[0], rec.origin[1], rec.origin[2]);
    const mats = [];
    g.scene.traverse((o) => {
      if (o.isMesh) {
        o.material.roughness = 1.0; o.material.metalness = 0.0;
        o.material.envMapIntensity = 0.16;   // shadows must stay dark
        if (hi[rec.parent]) { o.material.map = hi[rec.parent]; }
        o.castShadow = true; o.receiveShadow = true;
        // WET BAND: stone darkens and glosses within ~0.6 m of the
        // waterline (and below it) - grounds the floods
        // (strike light-pulse removed - Dele didn't like it)
        o.material.onBeforeCompile = (sh) => {
          sh.uniforms.uWaterY = waterUni;
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nvarying float vWetWY;')
            .replace('#include <begin_vertex>',
              '#include <begin_vertex>\nvWetWY = (modelMatrix * vec4(position, 1.0)).y;');
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>',
              '#include <common>\nvarying float vWetWY;\nuniform float uWaterY;')
            .replace('#include <color_fragment>',
              '#include <color_fragment>\n' +
              'float wetA = smoothstep(uWaterY + 0.6, uWaterY + 0.08, vWetWY);\n' +
              'diffuseColor.rgb *= mix(1.0, 0.62, wetA);')
            .replace('#include <roughnessmap_fragment>',
              '#include <roughnessmap_fragment>\n' +
              'float wetR = smoothstep(uWaterY + 0.6, uWaterY + 0.08, vWetWY);\n' +
              'roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.45, wetR);');
        };
        mats.push(o.material);
      }
    });
    // GLB was exported y-up from a z-up local frame; undo inside the holder
    g.scene.rotation.x = Math.PI / 2;
    holder.add(g.scene);
    world.add(holder);
    const p = { mesh: holder, restZ: rec.origin[2], y: 0, v: 0,
                order: rec.order, name: rec.name, mats, pulse: 0 };
    parts.push(p); byOrder[rec.order] = p;
    centroid.add(holder.position);
    res();
  }, undefined, () => res());   // a missing part never blocks the bank
});
const CHUNK = 6;
for (let i = 0; i < manifest.length; i += CHUNK) {
  await Promise.all(manifest.slice(i, i + CHUNK).map(loadOne));
  document.getElementById('gLoad').textContent =
    `assembling the bank — ${Math.min(i + CHUNK, manifest.length)} / ${manifest.length}`;
}
centroid.multiplyScalar(1 / Math.max(1, parts.length));
// THE GATE (Dele 2026-08-30, the piece as a work): arrival is designed.
// The bank assembles behind the title; ENTER is the single gesture - it
// arms the audio inside the click and begins the album.
document.getElementById('gLoad').textContent = 'the bank is assembled';
document.getElementById('gEnter').classList.add('ready');
if (KIOSK) setTimeout(() => document.getElementById('gEnter').click(), 800);

// (camera is fixed from camera.json - Dele's own frame; nothing to set here)

// ---------------------------------------------------------------- input --
const ray = new THREE.Raycaster();
// the canvas is LETTERBOXED and centred - picking must use its rect, not
// the window (clicks were offset on wide screens)
function pickPart(e) {
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1,
                                -((e.clientY - r.top) / r.height) * 2 + 1);
  if (ndc.x < -1 || ndc.x > 1 || ndc.y < -1 || ndc.y > 1) return null;
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(parts.map((p) => p.mesh), true);
  if (!hits.length) return null;
  let o = hits[0].object;
  while (o && !parts.some((p) => p.mesh === o)) o = o.parent;
  return parts.find((q) => q.mesh === o) || null;
}
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const p = pickPart(e);
  if (p) strike(p.order, 1.0);
});
// hover: the cursor tells you the keys are keys
let hoverT = 0;
canvas.addEventListener('pointermove', (e) => {
  const now = performance.now();
  if (now - hoverT < 90) return;
  hoverT = now;
  canvas.style.cursor = pickPart(e) ? 'pointer' : 'default';
});
function strike(order, vel, kind) {
  const p = byOrder[order];
  if (!p) return;
  if (kind === 'swell') {          // pads: soft, spread to neighbours
    p.v += 5 * vel * moodCur.imp;
    const a = byOrder[order - 1], b = byOrder[order + 1];
    if (a) a.v += 2.5 * vel * moodCur.imp;
    if (b) b.v += 2.5 * vel * moodCur.imp;
  } else if (kind === 'deep') {    // cello: one heavy push
    p.v += 14 * vel * moodCur.imp;
  } else {                         // sharp (celesta, stitch, clicks)
    p.v += 10 * vel * moodCur.imp;
  }
  musicEnergy = Math.min(6, musicEnergy + vel * 0.25);
}

// ---------------------------------------------------------------- MIDI --
// reads our own type-0 files (jw_music.py writes them byte by byte; this is
// the same arithmetic backwards) and plays the bank with a small FM pluck.
// ==================== THE SOUND ENGINE (rebuilt) ====================
// One AudioContext for the page's life, created inside a user click.
// loadSong() parses a MIDI and annotates every note with its second, its
// key on the bank and its pan. A LOOKAHEAD SCHEDULER (the canonical
// WebAudio pattern) then synthesises only the notes of the next ~0.45 s,
// every 100 ms - a handful of live nodes at any moment. Visual strikes,
// the progress bar and auto-next all read the audio clock in tick().
let audio = null, playing = false;
let song = null;                 // { notes, dur, vmax, master, tap }
let schedPtr = 0, visPtr = 0, songT0 = 0, schedTimer = null;
const liveOscs = new Set();

async function loadSong(url) {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const tpq = (buf[12] << 8) | buf[13];
  let i = buf.indexOf(0x4d, 14); // 'M' of MTrk
  i += 8;
  let t = 0, run = 0, usPerBeat = 1000000;
  const notes = [];
  const chanProg = {};
  const vlq = () => { let v = 0, b; do { b = buf[i++]; v = (v << 7) | (b & 127); } while (b & 128); return v; };
  while (i < buf.length) {
    t += vlq();
    let st = buf[i];
    if (st & 0x80) { run = st; i++; } st = run;
    if (st === 0xff) {
      const type = buf[i++]; const len = vlq();
      if (type === 0x51) usPerBeat = (buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2];
      i += len; if (type === 0x2f) break;
    } else {
      const hi = st & 0xf0;
      if (hi === 0x90 && buf[i + 1] > 0)
        notes.push({ t, n: buf[i], v: buf[i + 1] / 127, c: st & 0x0f,
                     prog: chanProg[st & 0x0f] || 0 });
      if (hi === 0xc0) chanProg[st & 0x0f] = buf[i];
      if (hi === 0x90 || hi === 0x80 || hi === 0xa0 || hi === 0xb0 || hi === 0xe0) i += 2;
      else if (hi === 0xc0 || hi === 0xd0) i += 1;
    }
  }
  const spb = usPerBeat / 1e6;
  // THE SPATIAL SCORE, annotated once per song: Naht's city voice plays the
  // LEFT bank, its water voices the RIGHT, the stitch alternates; other
  // tracks give each channel its own stretch of the bank.
  const isNaht = url.indexOf('naht') >= 0;
  const chans = [...new Set(notes.map((n) => n.c))].sort();
  const zone = {};
  chans.forEach((c, ci) => { zone[c] = [ci / chans.length, (ci + 1) / chans.length]; });
  const lo = {}, hi_ = {};
  for (const c of chans) {
    const ns = notes.filter((n) => n.c === c).map((n) => n.n);
    lo[c] = Math.min(...ns); hi_[c] = Math.max(...ns);
  }
  let stitchFlip = false;
  for (const n of notes) {
    n.sec = (n.t / tpq) * spb;
    const u = (n.n - lo[n.c]) / Math.max(1, hi_[n.c] - lo[n.c]);
    n.kind = 'sharp';
    if (isNaht && sideKeys.L.length && sideKeys.R.length) {
      let list;
      if (n.c === 2) { list = sideKeys.L; }
      else if (n.c === 0) { list = sideKeys.R; n.kind = 'swell'; }
      else if (n.c === 1) { list = sideKeys.R; n.kind = 'deep'; }
      else if (n.c === 3) { list = stitchFlip ? sideKeys.L : sideKeys.R;
                            stitchFlip = !stitchFlip; }
      else { list = parts; n.kind = 'swell'; }
      const p2 = list[Math.round(u * (list.length - 1))];
      n.order = p2 ? p2.order : 0;
    } else {
      const [z0, z1] = zone[n.c];
      n.order = Math.round((z0 + u * (z1 - z0)) * (byOrder.length - 1));
    }
    const tgt = byOrder[n.order];
    n.pan = tgt && tgt.ndcX !== undefined ? tgt.ndcX : 0;
  }
  const vmax = Math.max(0.2, ...notes.map((n) => n.v));
  return { notes, vmax, dur: notes.length ? notes[notes.length - 1].sec : 0 };
}

// THE VOICES (Phase 2, Dele 2026-08-30): the album's channels are real
// instruments - each GM program gets its own recipe, so the spatial score
// is AUDIBLE, not just visible. Amplitudes balanced to the old pluck.
// GM programs used by album 1: 4 epiano, 8 celesta, 11 vibes, 12 marimba,
// 14 bell, 38 synbass, 42 cello, 89 warm pad, 99 air.
function voiceRecipe(prog) {
  if ((prog >= 88 && prog <= 103) || (prog >= 48 && prog <= 54) ||
      (prog >= 60 && prog <= 63) || prog === 99)   // pads, air, choir, horns
    return { waves: [['sawtooth', 1, 0.16], ['sawtooth', 1.007, 0.16], ['sine', 0.5, 0.5]],
             att: 0.55, dur: 3.6, rel: 3.2, cut: 2.2, sweep: 1.4, amp: 0.75 };
  if (prog >= 40 && prog <= 47)                // strings, cello: bowed
    return { waves: [['sawtooth', 1, 0.5], ['sine', 1, 0.4]],
             att: 0.09, dur: 2.4, rel: 2.0, cut: 3.2, sweep: 2.0, amp: 0.8, vib: true };
  if (prog === 8)                              // celesta: bright and short
    return { waves: [['sine', 1, 0.8], ['sine', 4, 0.22]],
             att: 0.004, dur: 1.1, rel: 1.0, cut: 8, sweep: 3, amp: 0.95 };
  if (prog === 11)                             // vibes: shimmering decay
    return { waves: [['sine', 1, 0.85], ['sine', 4, 0.1]],
             att: 0.006, dur: 2.2, rel: 2.0, cut: 6, sweep: 2, amp: 0.9, trem: true };
  if (prog === 12)                             // marimba: woody knock
    return { waves: [['sine', 1, 0.9], ['sine', 3.9, 0.25]],
             att: 0.003, dur: 0.6, rel: 0.55, cut: 6, sweep: 2, amp: 1.0 };
  if (prog === 14)                             // bell: inharmonic, long
    return { waves: [['sine', 1, 0.7], ['sine', 2.76, 0.35], ['sine', 5.4, 0.14]],
             att: 0.004, dur: 2.8, rel: 2.6, cut: 9, sweep: 4, amp: 0.8 };
  if (prog === 38)                             // synbass: round punch
    return { waves: [['triangle', 1, 0.7], ['sawtooth', 1.004, 0.25], ['sine', 0.5, 0.5]],
             att: 0.008, dur: 0.7, rel: 0.6, cut: 2.4, sweep: 1.2, amp: 0.95 };
  // epiano (4) and anything unknown: the original tine pluck
  return { waves: [['sine', 1, 0.85], ['sine', 2.003, 0.22]],
           att: 0.012, dur: 1.8, rel: 1.6, cut: 6, sweep: 1.5, amp: 1.0 };
}
function synthNote(n, when) {
  const f = 440 * Math.pow(2, (n.n - 69) / 12);
  const r = voiceRecipe(n.prog);
  const g = audio.createGain(), flt = audio.createBiquadFilter();
  flt.type = 'lowpass';
  flt.frequency.setValueAtTime(Math.min(16000, f * r.cut), when);
  flt.frequency.exponentialRampToValueAtTime(
    Math.min(16000, Math.max(120, f * r.sweep)), when + r.dur * 0.7);
  const peak = 0.1 * r.amp * (0.35 + 0.65 * n.v);
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(peak, when + r.att);
  g.gain.exponentialRampToValueAtTime(0.0001, when + r.dur);
  const oscs = [];
  for (const [type, mult, amt] of r.waves) {
    const o = audio.createOscillator();
    o.type = type; o.frequency.value = f * mult;
    const og = audio.createGain(); og.gain.value = amt;
    o.connect(og).connect(flt);
    oscs.push(o);
  }
  if (r.vib) {                                 // gentle 5 Hz vibrato
    const lfo = audio.createOscillator(); lfo.frequency.value = 5;
    const lg = audio.createGain(); lg.gain.value = f * 0.004;
    lfo.connect(lg);
    oscs.forEach((o) => lg.connect(o.frequency));
    lfo.start(when); lfo.stop(when + r.dur + 0.2);
    liveOscs.add(lfo); lfo.onended = () => liveOscs.delete(lfo);
  }
  if (r.trem) {                                // vibraphone motor
    const lfo = audio.createOscillator(); lfo.frequency.value = 4.2;
    const lg = audio.createGain(); lg.gain.value = peak * 0.3;
    lfo.connect(lg).connect(g.gain);
    lfo.start(when); lfo.stop(when + r.dur + 0.2);
    liveOscs.add(lfo); lfo.onended = () => liveOscs.delete(lfo);
  }
  const panner = audio.createStereoPanner();
  panner.pan.value = n.pan;
  flt.connect(g).connect(panner).connect(song.master);
  panner.connect(song.tap);
  for (const o of oscs) {
    o.start(when); o.stop(when + r.dur + 0.15);
    liveOscs.add(o);
  }
  oscs[0].onended = () => oscs.forEach((o) => liveOscs.delete(o));
}

function scheduleAhead() {
  if (!playing || !song || !audio) return;
  const horizon = audio.currentTime + 0.45;
  let made = 0;
  while (schedPtr < song.notes.length) {
    const n = song.notes[schedPtr];
    const when = songT0 + n.sec;
    if (when > horizon) break;
    synthNote(n, Math.max(when, audio.currentTime + 0.02));
    schedPtr++;
    if (++made > 240) break;    // never block a frame
  }
}
const TRACKS = [
  ['01_kleinbasel_drift.mid', 'kleinbasel drift'],
  ['02_overcast.mid', 'overcast'],
  ['03_nachtschicht.mid', 'nachtschicht'],
  ['04_pegel.mid', 'pegel'],
  ['05_faehre.mid', 'faehre'],
  ['06_zweimal.mid', 'zweimal'],
  ['07_rheinschwimmen.mid', 'rheinschwimmen'],
];
// PER-SONG VISUAL COMPOSITIONS (Dele 2026-08-30): five variables - spring,
// river datum, river speed, time of day, weather. Camera and rest positions
// never change. Cross-fades over ~4 s at every track change.
// Each song is a TIMELINE, not a picture (Dele 2026-08-30): the table is
// only the starting position. `script` keyframes (at = fraction of the song)
// override variables cumulatively; the engine interpolates between frames,
// so rain arrives, lightning passes, fog comes and goes - the song decides.
const MDEF = { fog: 0, rain: 0, storm: 0, wtint: 0 };
const SONGS = {
  // bright midday on the bank, the water at 9 m - a gentle breathing light
  '01_kleinbasel_drift.mid': { base: { wtint: 0.45, wcol: 0x14b39a, el: 55, az: 195, sun: 0xffffff,
      sunInt: 4.8, hemi: 0.35, envI: 1.0, turb: 3, ray: 1.0, skyBelow: 0,
      datum: 2.1, flow: 0.25, coupling: 0.6, K: 14, damp: 4.5, imp: 0.6,
      dist: 0.5 },
    script: [ { at: 0.3, sunInt: 4.2 },
              { at: 0.55, sunInt: 5.0 },
              { at: 0.85, sun: 0xfff4e0, sunInt: 4.6 } ] },
  // grey stillness - the rain arrives mid-song, pours, breaks at the end
  '02_overcast.mid': { base: { wtint: 0.15, wcol: 0x4a7f74, el: 45, az: 180, sun: 0xdfe3e8, sunInt: 2.2,
      hemi: 0.62, envI: 0.55, turb: 10, ray: 0.4, skyBelow: 0, datum: 2.5,
      flow: 0.35, coupling: 0.5, K: 18, damp: 6.0, imp: 0.5, dist: 0.35 },
    script: [ { at: 0.25, rain: 0.35, hemi: 0.58 },
              { at: 0.42, rain: 0.45 },
              { at: 0.5, rain: 1.0, flow: 0.55, sunInt: 2.4,
                datum: 3.5, turb: 12, wcol: 0x33625c },
              { at: 0.75, rain: 1.0 },
              { at: 1, rain: 0.25, sunInt: 2.8, sun: 0xf2e7d4, turb: 7 } ] },
  // the night shift - a storm crosses the far bank, then a clear moon
  '03_nachtschicht.mid': { base: { wtint: 0.35, wcol: 0x123f38, el: 32, az: 60, sun: 0xc3d4f0,
      sunInt: 3.0, hemi: 0.34, envI: 0.4, turb: 3, ray: 0.2, skyBelow: 1,
      datum: 4.0, flow: 0.15, coupling: 0.8, K: 10, damp: 3.5, imp: 1.0,
      dist: 0.3 },
    script: [ { at: 0.25, storm: 0.35, turb: 5 },
              { at: 0.45, storm: 1.0, rain: 0.5, flow: 0.3, hemi: 0.3 },
              { at: 0.65, storm: 0.4, rain: 0.15 },
              { at: 0.85, storm: 0, rain: 0, sunInt: 3.4, envI: 0.42,
                turb: 2.5 } ] },
  // the gauge - the river rises to a crest and falls back; water IS the piece
  '04_pegel.mid': { base: { wtint: 0.35, wcol: 0x1f8a76, el: 13, az: 250, sun: 0xff9e50, sunInt: 4.6,
      hemi: 0.55, envI: 0.85, turb: 8, ray: 2.2, skyBelow: 0, datum: 0.5,
      flow: 0.2, coupling: 2.2, K: 20, damp: 6.0, imp: 0.35, dist: 0.45 },
    script: [ { at: 0.35, datum: 4, flow: 0.5, coupling: 2.6 },
              { at: 0.6, datum: 6.5, flow: 0.9, dist: 0.8, wcol: 0x2e7257 },
              { at: 0.72, datum: 10.1 },   // pegel +2 m total (Dele) -> level 13.00
              { at: 1, datum: 1.5, flow: 0.25, coupling: 1.2, dist: 0.45, wcol: 0x1f8a76 } ] },
  // the crossing - wind gusts mid-river, calm on arrival
  '05_faehre.mid': { base: { wtint: 0.55, wcol: 0x0fadaa, el: 35, az: 210, sun: 0xfff0d8, sunInt: 4.5,
      hemi: 0.3, envI: 0.8, turb: 4, ray: 1.2, skyBelow: 0, datum: 3.5,
      flow: 1.4, coupling: 0.7, K: 16, damp: 4.0, imp: 0.9, dist: 0.7 },
    script: [ { at: 0.3, flow: 1.8, dist: 1.1, turb: 5 },
              { at: 0.55, flow: 2.3, dist: 1.5, sunInt: 3.4 },
              { at: 0.8, flow: 0.8, dist: 0.7, sunInt: 4.8 },
              { at: 1, flow: 0.5 } ] },
  // noon sparkle - the sun-shower passes TWICE, as the name asks
  '06_zweimal.mid': { base: { wtint: 0.65, wcol: 0x10b3b0, el: 55, az: 190, sun: 0xffffff, sunInt: 5.0,
      hemi: 0.35, envI: 1.0, turb: 3, ray: 1.0, skyBelow: 0, datum: 0.8,
      flow: 0.6, coupling: 0.6, K: 26, damp: 2.6, imp: 0.8, dist: 1.4 },
    script: [ { at: 0.2 },
              { at: 0.28, rain: 0.55, turb: 5, sunInt: 4.2 },
              { at: 0.4, rain: 0, turb: 3, sunInt: 5.2 },
              { at: 0.6, rain: 0.55, turb: 5, sunInt: 4.2 },
              { at: 0.75, rain: 0, turb: 3, sunInt: 5.5, dist: 1.6 } ] },
  // the evening swim - high water, the sun sets, a strong moon rises
  '07_rheinschwimmen.mid': { base: { wtint: 0.4, wcol: 0x189a84, el: 10, az: 235, sun: 0xffc080,
      sunInt: 4.2, hemi: 0.35, envI: 0.8, turb: 5, ray: 2.0, skyBelow: 0,
      datum: 5.0, flow: 0.8, coupling: 1.0, K: 7, damp: 2.2, imp: 0.5,
      dist: 0.6 },
    script: [ { at: 0.3, datum: 6, flow: 1.0 },
              { at: 0.55, el: 5, sun: 0xff9a50, sunInt: 3.4 },
              { at: 0.75, el: 8, sunInt: 3.2, hemi: 0.38, sun: 0xd8c8b8 },
              { at: 1, el: 20, sunInt: 3.6, envI: 0.5,
                sun: 0xc3d4f0, hemi: 0.38, flow: 0.4, wcol: 0x123f38 } ] },
};
// resolve each script into full frames (cumulative overrides), colors baked
const MKEYS = ['el', 'az', 'sunInt', 'hemi', 'envI', 'turb', 'ray',
  'skyBelow', 'datum', 'flow', 'coupling', 'K', 'damp', 'imp', 'dist',
  'fog', 'rain', 'storm', 'wtint'];
for (const name of Object.keys(SONGS)) {
  const song = SONGS[name];
  let acc = Object.assign({}, MDEF, song.base);
  song.frames = [Object.assign({ at: 0 }, acc)];
  for (const kf of song.script) {
    acc = Object.assign({}, acc, kf);
    song.frames.push(Object.assign({}, acc, { at: kf.at }));
  }
  for (const f of song.frames) {
    f.sunC = new THREE.Color(f.sun);
    f.wcolC = new THREE.Color(f.wcol);
  }
}
const tmpSunC = new THREE.Color();
const tmpWaterC = new THREE.Color();
const moodWaterColor = new THREE.Color(0x14b39a);
const whiteTint = new THREE.Color(0xffffff);
const idleWaterColor = new THREE.Color(0x14b39a);
function songMoodAt(song, prog) {
  const fr = song.frames;
  let i = 0;
  while (i < fr.length - 1 && fr[i + 1].at <= prog) i++;
  const a = fr[i], b = fr[Math.min(i + 1, fr.length - 1)];
  const t = a === b ? 0 : Math.min(1, Math.max(0,
    (prog - a.at) / Math.max(1e-6, b.at - a.at)));
  const out = {};
  for (const key of MKEYS) out[key] = a[key] + (b[key] - a[key]) * t;
  tmpSunC.copy(a.sunC).lerp(b.sunC, t);
  tmpWaterC.copy(a.wcolC).lerp(b.wcolC, t);
  return out;
}
// THE DEFAULT SCREEN IS KLEINBASEL DRIFT'S OPENING (Dele 2026-08-30):
// idle shows song 01's start exactly, so pressing play changes nothing.
let moodTarget = SONGS['01_kleinbasel_drift.mid'];
const moodCur = Object.assign({}, MDEF, { el: 55, az: 195, sunInt: 4.8,
  hemi: 0.35, envI: 1.0, turb: 3, ray: 1.0, skyBelow: 0, datum: 2.1,
  flow: 0.25, coupling: 0.6, K: 14, damp: 4.5, imp: 0.6, dist: 0.5,
  wtint: 0.45 });
const moodSunColor = new THREE.Color(0xffffff);

// idle water level = kleinbasel's own level, applied immediately
const IDLE_LEVEL = Math.min(13, waterBaseY +
  Math.max(...SONGS['01_kleinbasel_drift.mid'].frames.map((f) => f.datum)) * 0.5);
water.position.y = IDLE_LEVEL;
levelTarget = IDLE_LEVEL;
let trackIdx = 0, playDur = 0, startId = 0;
const bPlay = document.getElementById('bPlay');
const tTitle = document.getElementById('tTitle');
const tFill = document.getElementById('tFill');
function stopAll() {
  playing = false;
  if (schedTimer) { clearInterval(schedTimer); schedTimer = null; }
  for (const o of liveOscs) { try { o.stop(); } catch (e) {} }
  liveOscs.clear();
  if (song) { try { song.master.disconnect(); song.tap.disconnect(); if (song.comp) song.comp.disconnect(); } catch (e) {} }
  song = null;
  // the AudioContext stays alive for the page's life (autoplay policy)
  moodTarget = SONGS['01_kleinbasel_drift.mid'];   // idle = song 01's opening
  levelTarget = IDLE_LEVEL;
  bPlay.textContent = '\u25B6';
}
async function startTrack(i) {
  stopAll();
  trackIdx = ((i % TRACKS.length) + TRACKS.length) % TRACKS.length;
  moodTarget = SONGS[TRACKS[trackIdx][0]] || null;
  // the water finds ONE level per song (its highest scripted datum) and
  // holds it - Dele: no level changes during a song, no flicker
  levelTarget = moodTarget
    ? Math.min(13, waterBaseY +
        Math.max(...moodTarget.frames.map((f) => f.datum)) * 0.5)
    : waterBaseY;
  tTitle.textContent = TRACKS[trackIdx][1];
  playing = true; bPlay.textContent = '\u25A0';
  const my = ++startId;
  const data = await loadSong('./music/' + TRACKS[trackIdx][0]);
  if (my !== startId || !playing) return;   // superseded by a newer click
  if (!audio) armAudio();
  const master = audio.createGain();
  // per-song loudness normalisation (kleinbasel drift peaks at velocity
  // 62/127 - without this it whispers next to the other songs)
  master.gain.value = (window.__mute ? 0 : 1) * Math.min(2.2, 0.9 / data.vmax);
  // gentle safety compressor - richer voices must never clip
  const comp = audio.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 20;
  comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
  master.connect(comp).connect(audio.destination);
  const tap = audio.createAnalyser();
  tap.fftSize = 2048;
  window.__tap = tap;
  window.__tapInfo = { vmax: data.vmax, notes: data.notes.length,
                       master: master.gain.value };
  song = { notes: data.notes, dur: data.dur, vmax: data.vmax, master, tap, comp };
  playDur = data.dur;
  songT0 = audio.currentTime + 0.35;
  schedPtr = 0; visPtr = 0;
  schedTimer = setInterval(scheduleAhead, 100);
  scheduleAhead();
}
// debug: jump inside the current song without a note burst
window.__seek = (sec) => {
  if (!song || !audio) return 'no song';
  songT0 = audio.currentTime - sec;
  while (schedPtr < song.notes.length && song.notes[schedPtr].sec < sec) schedPtr++;
  visPtr = schedPtr;
  return 'seek ' + sec + ' / dur ' + song.dur.toFixed(1);
};
// the AudioContext MUST be created/resumed synchronously inside the click
// (Chrome autoplay policy) - creating it after `await fetch` left the very
// first song's context suspended forever: silence on track 01 only
function armAudio() {
  if (!audio) audio = new AudioContext();
  if (audio.state === 'suspended') audio.resume();
  // iOS: WebAudio obeys the RINGER SWITCH unless an <audio> element is
  // playing - loop a silent clip so the phone treats us as media playback
  if (!window.__silentEl) {
    const a = document.createElement('audio');
    a.setAttribute('playsinline', '');
    a.loop = true;
    a.src = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
    a.play().catch(() => {});
    window.__silentEl = a;
  }
}
bPlay.onclick = () => { armAudio(); playing ? stopAll() : startTrack(trackIdx); };
document.getElementById('bPrev').onclick = () => { armAudio(); startTrack(trackIdx - 1); };
document.getElementById('bNext').onclick = () => { armAudio(); startTrack(trackIdx + 1); };
tTitle.textContent = TRACKS[trackIdx][1];
{
  const gate = document.getElementById('gate');
  document.getElementById('gEnter').onclick = () => {
    armAudio();                       // inside the gesture - sound is legal
    document.body.classList.add('entered');
    gate.style.opacity = '0';
    gate.style.pointerEvents = 'none';
    setTimeout(() => gate.remove(), 1500);
    startTrack(0);
    // one-time discovery hint
    let hinted = false;
    try { hinted = localStorage.getItem('seamHint') === '1'; } catch (e) {}
    if (!hinted) {
      const h = document.getElementById('hint');
      setTimeout(() => h.classList.add('show'), 2500);
      const done = () => { h.classList.remove('show');
        try { localStorage.setItem('seamHint', '1'); } catch (e) {} };
      setTimeout(done, 12000);
      canvas.addEventListener('pointerdown', done, { once: true });
    }
  };
  const about = document.getElementById('about');
  document.getElementById('bInfo').onclick = () => about.classList.toggle('open');
  about.onclick = (e) => { if (e.target === about) about.classList.remove('open'); };
}
// the quality toggle: reloads with the chosen tier
{
  const bL = document.getElementById('bLow'), bH = document.getElementById('bHigh');
  (HI ? bH : bL).style.opacity = '1';
  (HI ? bH : bL).style.color = '#cbb98a';
  (HI ? bL : bH).style.opacity = '.4';
  const setQ = (q) => { try { localStorage.setItem('seamQuality', q); } catch (e) {}
    location.reload(); };
  bL.onclick = () => { if (HI) setQ('low'); };
  bH.onclick = () => { if (!HI) setQ('high'); };
}

// ---------------------------------------------------------------- loop --
const clock = new THREE.Clock();
let breathT = 330;   // arrive mid-morning; the cycle finds night on its own
// AUTO QUALITY (Dele: it must run on laptops and phones). A ladder of
// render budgets; the page senses its own frame rate and steps down until
// it holds - resolution and shadows degrade before anything visible breaks.
const IS_MOBILE = /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 2 && screen.width < 1100);
// HIGH is pinned at full render; LOW starts sensible and steps down until
// the frame rate holds (phones may land on the last rung)
const Q_PR = HI ? [2] : [1.25, 1, 0.85];
const Q_SHADOW = HI ? [8192] : [2048, 1024, 1024];
let qLevel = HI ? 0 : (IS_MOBILE ? 1 : 0);
function applyQuality() {
  renderer.setPixelRatio(Q_PR[qLevel]);
  sun.shadow.mapSize.setScalar(Q_SHADOW[qLevel]);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  gtao.enabled = HI;
  console.log('tier', QUALITY, 'level', qLevel, '- pr', Q_PR[qLevel],
              'shadow', Q_SHADOW[qLevel], 'gtao', gtao.enabled);
}
applyQuality();
let fpsAcc = 0, fpsN = 0;
function tick() {
  const rawDt = clock.getDelta();
  const dt = Math.min(0.05, rawDt);
  // frame-rate sensing: ignore watchdog/hidden gaps (rawDt > 0.12)
  if (rawDt < 0.12) {
    fpsAcc += rawDt; fpsN++;
    if (fpsAcc > 4) {
      const fps = fpsN / fpsAcc;
      fpsAcc = 0; fpsN = 0;
      if (fps < 45 && qLevel < Q_PR.length - 1) { qLevel++; applyQuality(); }
      // an auto-chosen HIGH that stutters demotes itself to LOW once
      // (never overrides an explicit button choice)
      if (HI && AUTO_TIER && fps < 33 &&
          !sessionStorage.getItem('seamDemoted')) {
        try {
          sessionStorage.setItem('seamDemoted', '1');
          localStorage.removeItem('seamQuality');
        } catch (e) {}
        location.replace(location.pathname + '?tier=low' + location.hash);
      }
    }
  }
  // the idle breath: a slow swell wanders along the bank so the
  // installation waves a little even untouched - never breaks, only breathes
  breathT += dt;
  // THE RIVER FLOWS AND THE DAY TURNS - day 20 min, night 2 min with
  // moonlight (Dele, 2026-08-30). One cycle = 1320 s.
  {
    // the river's speed follows the song (flow 0.15 slow .. 2.3 gusts)
    const cfg = water.material.uniforms['config'].value;
    const cycle = 0.15, half = 0.075;
    // floor + song character: every song flows like the faehre he approved,
    // slow songs gently, gusts fast
    cfg.x += (0.010 + moodCur.flow * 0.013) * dt;
    cfg.y = cfg.x + half;
    if (cfg.x >= cycle) { cfg.x = 0; cfg.y = half; }
    else if (cfg.y >= cycle) { cfg.y -= cycle; }
  }
  if (!window.__hold && moodTarget) {
    // SONG MOOD: the composition is a timeline - interpolate the script's
    // keyframes at the song's progress, then chase (the chase smooths both
    // the track-change cross-fade and every keyframe step)
    const prog = window.__progOverride !== undefined ? window.__progOverride
      : (playDur > 0 && song && audio)
      ? Math.min(1, Math.max(0, (audio.currentTime - songT0) / playDur))
      : 0;
    const mt = songMoodAt(moodTarget, prog);
    const k = Math.min(1, dt / 2.5);
    for (const key of MKEYS) moodCur[key] += (mt[key] - moodCur[key]) * k;
    moodSunColor.lerp(tmpSunC, k);
    moodWaterColor.lerp(tmpWaterC, k);
    water.material.uniforms['color'].value.copy(moodWaterColor)
      .lerp(whiteTint, 0.45);
    deepWater.material.color.copy(moodWaterColor).multiplyScalar(1.15);
    // (rain-roughness via scale was WRONG: scale animates about the plane
    // corner and reads as diagonal drift - reverted, Dele caught it)
    K += (moodCur.K - K) * k;
    DAMP += (moodCur.damp - DAMP) * k;
    const elR = THREE.MathUtils.degToRad(moodCur.el);
    const azR = THREE.MathUtils.degToRad(moodCur.az);
    const sd = new THREE.Vector3(Math.cos(azR) * Math.cos(elR), Math.sin(elR),
                                 Math.sin(azR) * Math.cos(elR)).normalize();
    sun.position.copy(sd).multiplyScalar(600).add(sunFocus);
    sun.color.copy(moodSunColor);
    sun.intensity = moodCur.sunInt;
    hemi.intensity = moodCur.hemi;
    scene.environmentIntensity = moodCur.envI;
    sky.material.uniforms.turbidity.value = moodCur.turb;
    sky.material.uniforms.rayleigh.value = moodCur.ray;
    if (water.userData.glintU) {
      water.userData.glintU.sunDirW.value.copy(sd);
      water.userData.glintU.sunColW.value.copy(moodSunColor);
      water.userData.glintU.glint.value =
        Math.min(1, moodCur.sunInt / 5) * 0.35 *
        Math.min(1, moodCur.el / 50);   // kept restrained everywhere - Dele's taste
    }
    sky.material.uniforms.sunPosition.value.copy(
      moodCur.skyBelow > 0.5
        ? sd.clone().multiplyScalar(-1).setY(-0.2).normalize() : sd);
  } else if (!window.__hold) {
  // idle: weather withdraws, the living day returns
  moodCur.fog *= Math.exp(-dt / 3);
  moodCur.rain *= Math.exp(-dt / 3);
  moodCur.storm = 0;
  moodWaterColor.lerp(idleWaterColor, Math.min(1, dt / 5));
  water.material.uniforms['color'].value.copy(moodWaterColor)
    .lerp(whiteTint, 0.45);
  deepWater.material.color.copy(moodWaterColor).multiplyScalar(1.15);
  const CYCLE = 1320, DAYFRAC = 1200 / 1320;
  const u = (breathT % CYCLE) / CYCLE;
  let sd, warm, inten, hemiI, envI;
  if (u < DAYFRAC) {
    const d = u / DAYFRAC;
    const el = THREE.MathUtils.degToRad(3 + 35 * Math.sin(Math.PI * d));
    const az = Math.PI + THREE.MathUtils.degToRad(-70 + 140 * d);
    sd = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el),
                           Math.sin(az) * Math.cos(el)).normalize();
    const low = 1 - Math.min(1, sd.y / 0.35);
    warm = new THREE.Color(0xffffff).lerp(new THREE.Color(0xff9a4d), low);
    inten = 1.2 + 4.8 * Math.min(1, sd.y / 0.3);
    hemiI = 0.12 + 0.22 * Math.min(1, sd.y / 0.3);
    envI = 0.4 + 0.6 * Math.min(1, sd.y / 0.3);
  } else {
    const n = (u - DAYFRAC) / (1 - DAYFRAC);
    const el = THREE.MathUtils.degToRad(20 + 18 * Math.sin(Math.PI * n));
    const az = THREE.MathUtils.degToRad(30 + 60 * n);
    sd = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el),
                           Math.sin(az) * Math.cos(el)).normalize();
    warm = new THREE.Color(0xc3d4f0);   // strong moonlight - Dele: night must stay legible
    inten = 1.8; hemiI = 0.2; envI = 0.25;
  }
  sun.position.copy(sd).multiplyScalar(600).add(sunFocus);
  sun.color.copy(warm); sun.intensity = inten;
  hemi.intensity = hemiI;
  scene.environmentIntensity = envI;
  sky.material.uniforms.sunPosition.value.copy(
    u < DAYFRAC ? sd : sd.clone().multiplyScalar(-1).setY(-0.2).normalize());
  }
  // WEATHER LAYERS - fog, rain, lightning (the songs summon them)
  scene.fog.density = 0;   // FOG CANCELLED - Dele 2026-08-30: it only blurred the vision
  fogColor.copy(moodSunColor).lerp(new THREE.Color(0xb8c2ca), 0.65)
    .multiplyScalar(Math.min(1, Math.max(0.12, moodCur.sunInt / 4)));
  rain.visible = moodCur.rain > 0.03;
  if (rain.visible) {
    rain.material.opacity = Math.min(1, moodCur.rain * 0.85);
    const pa = rain.geometry.attributes.position, vv = rain.userData.vel,
          ll = rain.userData.lens, sl = rain.userData.slant;
    for (let i = 0; i < vv.length; i++) {
      const fall = vv[i] * dt;
      let y = pa.array[i * 6 + 1] - fall;
      let x = pa.array[i * 6] - fall * sl;   // the wind carries it sideways
      if (y < -5) { y += 165; }
      if (x < -304) x += 360; else if (x > 56) x -= 360;
      pa.array[i * 6] = x;
      pa.array[i * 6 + 1] = y;
      pa.array[i * 6 + 3] = x + ll[i] * sl;
      pa.array[i * 6 + 4] = y + ll[i];
    }
    pa.needsUpdate = true;
  }
  if (moodCur.storm > 0.05 && flashT <= 0 &&
      Math.random() < moodCur.storm * dt * 0.35) {
    flashT = 0.22 + Math.random() * 0.25;
  }
  if (flashT > 0) {
    flashT -= dt;
    const fb = Math.max(0, flashT) * (Math.random() < 0.72 ? 1 : 0.15);
    sun.intensity += fb * 55;
    hemi.intensity += fb * 5;
  }
  // THE LEVEL (Dele 2026-08-30): locked per song. On a song change the
  // water glides swiftly to the new level (1.4 m/s, dead stop, zero
  // oscillation) and then does not move again until the next song.
  musicEnergy *= Math.exp(-dt / 6);   // still feeds the springs' feel
  {
    const err = levelTarget - water.position.y;
    if (Math.abs(err) > 0.001) {
      water.position.y += Math.sign(err) * Math.min(Math.abs(err), 1.4 * dt);
    }
  }
  waterUni.value = water.position.y;
  waterClock.value = breathT;
  // the idle breath (very subtle - Dele)
  for (const p of parts) {
    const phase = breathT * 0.35 - p.order * 0.45;
    p.v += Math.sin(phase) * 0.018 * dt * 60 * 0.016;
  }
  for (const p of parts) {
    const phase = breathT * 0.35 - p.order * 0.45;
    p.v += Math.sin(phase) * 0.018 * dt * 60 * 0.016;   // very subtle - Dele 2026-08-30
  }
  // damped springs with weak neighbour coupling: it waves, it never breaks
  for (const p of parts) {
    let neigh = 0;
    const a = byOrder[p.order - 1], b = byOrder[p.order + 1];
    if (a) neigh += a.y - p.y;
    if (b) neigh += b.y - p.y;
    const acc = -K * p.y - DAMP * p.v + COUPLE * neigh;
    p.v += acc * dt;
    p.y = THREE.MathUtils.clamp(p.y + p.v * dt, -MAXY * 0.3, MAXY);
    p.mesh.position.x = p.restX + p.dir.x * p.y;
    p.mesh.position.y = p.restY + p.dir.y * p.y;
    p.mesh.position.z = p.restZ + p.dir.z * p.y;   // 45 deg toward the river
  }
  // LOCKED VIEW: the frame is 16:9 always - wider windows get black
  // pillars instead of revealing world beyond Dele's framing
  const AR = 16 / 9;
  let w = innerWidth, h = innerHeight;
  if (w / h > AR) w = Math.round(h * AR); else h = Math.round(w / AR);
  if (canvas.style.width !== w + 'px') {
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  }
  if (canvas.width !== w * renderer.getPixelRatio() ||
      canvas.height !== h * renderer.getPixelRatio()) {
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = AR; camera.updateProjectionMatrix();
  }
  if (playing && song && audio) {
    const pos = audio.currentTime - songT0;
    // visual strikes fire from the audio clock itself - always in sync
    while (visPtr < song.notes.length && song.notes[visPtr].sec <= pos) {
      const n = song.notes[visPtr++];
      strike(n.order, n.v, n.kind);
    }
    tFill.style.width =
      (Math.min(1, Math.max(0, pos / Math.max(0.001, playDur))) * 100)
        .toFixed(2) + '%';
    if (pos > playDur + 2.5) startTrack(trackIdx + 1);
  } else if (!playing) { tFill.style.width = '0%'; }
  // a transient render error (e.g. zero-size canvas while the window is
  // hidden) must never kill the loop - the rAF chain is the heartbeat
  if (w > 0 && h > 0) { try { composer.render(); } catch (e) {} }
  lastTickMs = performance.now();
  requestAnimationFrame(tick);
}
// WATCHDOG: some embedded/hidden windows never fire requestAnimationFrame;
// keep a slow heartbeat so the piece is alive (and in sync) when seen again
let lastTickMs = 0;
setInterval(() => {
  if (performance.now() - lastTickMs > 400) tick();
}, 150);
document.getElementById('status').textContent = `${parts.length} keys`;
// bank sides in Dele's frame: L and R of the channel - the two voices
{
  const vtmp = new THREE.Vector3();
  for (const p of parts) {
    vtmp.copy(p.mesh.position).applyAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const ndc = vtmp.project(camera);
    p.ndcX = Math.max(-0.95, Math.min(0.95, ndc.x));
    p.side = ndc.x < 0 ? 'L' : 'R';
  }
}
// 45-DEGREE SPRING (Dele 2026-08-30): pieces bounce diagonally TOWARD
// the river, matching how the skirts were built and installed. Each part
// stores its unit direction: horizontal toward the channel axis + up, 45.
{
  const axv = [Math.cos(bank.ang), Math.sin(bank.ang)];
  for (const p of parts) {
    // part position in z-up world-group coords
    const px = p.mesh.position.x, py = p.mesh.position.y;
    const dx = px - bank.mid[0], dy = py - bank.mid[1];
    const t = dx * axv[0] + dy * axv[1];
    const footx = bank.mid[0] + axv[0] * t, footy = bank.mid[1] + axv[1] * t;
    let hx = footx - px, hy = footy - py;
    const hl = Math.hypot(hx, hy) || 1;
    hx /= hl; hy /= hl;
    const k = Math.SQRT1_2;
    p.dir = { x: hx * k, y: hy * k, z: k };
    p.restX = px; p.restY = py;
    p.footX = footx; p.footY = footy;   // the part's point on the channel axis
  }
}
const sideKeys = {
  L: parts.filter((p) => p.side === 'L').sort((a, b) => a.order - b.order),
  R: parts.filter((p) => p.side === 'R').sort((a, b) => a.order - b.order),
};
window.__DBG = { sun, camera, water, scene, renderer, parts, composer,
  sideKeys, moodCur, SONGS, rain, startTrack, stopAll,
  songMoodAt, tmpSunC, moodSunColor, tmpWaterC, moodWaterColor,
  strike, byOrder, waterUni };
tick();   // the engine starts only after every part has its spring direction
