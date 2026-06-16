#!/usr/bin/env python3
"""Generate a 3D "solar system" visualization of the graphify code graph.

Voice Cloning Webapp edition — a multi-service system, so:
  * Sun  = a synthetic "Voice Cloning" core star (no single app shell).
  * Orbit rings (inner -> outer) follow the request/data-flow pipeline:
        Client -> Live Gateway -> Lambda (API) -> GPU Workers -> Docker/Infra
  * Planets = code files & symbols; size by graph degree, colour by layer.
  * docs/ (markdown) is excluded so the rings read as real architecture.
  * Edges show on hover so it never becomes a hairball.

Re-run after the graph rebuilds:  python scripts/solar-system.py
"""
from __future__ import annotations
import json, os, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_GRAPH = os.path.normpath(os.path.join(HERE, "..", "graphify-out", "graph.json"))
DEFAULT_OUT = os.path.normpath(os.path.join(HERE, "..", "graphify-out", "solar-system.html"))

PROJECT = "Voice Cloning Webapp"
SUN_LABEL = "Voice Cloning"
SUN_COLOR = 0xffd54f

# inner -> outer; colour follows the pipeline (cool client -> hot GPU)
LAYERS = {
    "client":  {"name": "Client (frontend)", "r": 22, "color": 0x4fc3f7, "speed": 1.00},
    "gateway": {"name": "Live Gateway",       "r": 34, "color": 0x4dd0e1, "speed": 0.74},
    "lambda":  {"name": "Lambda (API)",       "r": 47, "color": 0xffb74d, "speed": 0.54},
    "gpu":     {"name": "GPU Workers",        "r": 62, "color": 0xef5350, "speed": 0.40},
    "infra":   {"name": "Docker · Infra",     "r": 80, "color": 0x66bb6a, "speed": 0.24},
}
ORDER = ["client", "gateway", "lambda", "gpu", "infra"]


def classify(node) -> str:
    """Map a node to an orbital layer by its top-level directory. '' = drop."""
    sf = (node.get("source_file") or "").replace("\\", "/")
    if not sf:
        return ""
    base = sf.rsplit("/", 1)[-1]
    top = sf.split("/", 1)[0] if "/" in sf else ""

    if top == "docs":
        return ""  # excluded
    if "/" not in sf and base.lower().endswith(".md"):
        return ""  # root readmes are docs too

    if top == "client":
        return "client"
    if top == "live-gateway":
        return "gateway"
    if top == "lambda":
        return "lambda"
    if top in ("gpu-worker", "gpu-inference-worker"):
        return "gpu"
    if top == "docker":
        return "infra"
    if "/" not in sf:
        return "infra"  # root config files (package.json, Dockerfile, etc.)
    return "infra"


def build(graph_path: str):
    g = json.load(open(graph_path, encoding="utf-8"))
    nodes = g["nodes"]
    links = g.get("links", g.get("edges", []))

    deg = collections.Counter()
    for e in links:
        deg[e["source"]] += 1
        deg[e["target"]] += 1

    # keep only classified (non-docs) nodes, build old-id -> new-index map
    keep = {}
    out_nodes = []
    for n in nodes:
        layer = classify(n)
        if not layer:
            continue
        keep[n["id"]] = len(out_nodes)
        out_nodes.append({
            "label": n.get("label", n["id"]),
            "file": n.get("source_file", ""),
            "layer": layer,
            "deg": deg.get(n["id"], 0),
        })

    out_edges = []
    for e in links:
        s, t = keep.get(e["source"]), keep.get(e["target"])
        if s is not None and t is not None and s != t:
            out_edges.append([s, t])

    return {
        "project": PROJECT, "sunLabel": SUN_LABEL, "sunColor": SUN_COLOR,
        "layers": LAYERS, "order": ORDER,
        "nodes": out_nodes, "edges": out_edges,
        "commit": (g.get("built_at_commit") or "")[:8],
    }


def main():
    graph_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_GRAPH
    out_path = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUT
    if not os.path.exists(graph_path):
        sys.exit(f"graph not found: {graph_path}\nRun graphify first, or pass the path as arg 1.")

    data = build(graph_path)
    html = HTML_TEMPLATE.replace("__DATA_JSON__", json.dumps(data, separators=(",", ":")))
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)

    counts = collections.Counter(n["layer"] for n in data["nodes"])
    print(f"Wrote {out_path}")
    print(f"  {len(data['nodes'])} planets, {len(data['edges'])} edges, commit {data['commit']}")
    print("  rings: " + ", ".join(f"{k}={counts[k]}" for k in ORDER if counts[k]))


HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>code solar system</title>
<style>
  html,body{margin:0;height:100%;background:#04060f;color:#cdd6f4;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;overflow:hidden}
  #c{display:block;width:100vw;height:100vh}
  #title{position:fixed;top:16px;left:18px;z-index:5;pointer-events:none}
  #title h1{margin:0;font-size:17px;font-weight:600;letter-spacing:.3px}
  #title p{margin:3px 0 0;font-size:11.5px;color:#7f8aa3}
  #legend{position:fixed;bottom:16px;left:18px;z-index:5;font-size:12px;
    background:rgba(10,14,28,.55);border:1px solid #1d2740;border-radius:10px;
    padding:10px 12px;backdrop-filter:blur(6px)}
  #legend .row{display:flex;align-items:center;gap:8px;margin:3px 0}
  #legend .dot{width:10px;height:10px;border-radius:50%;box-shadow:0 0 8px currentColor}
  #legend .ct{color:#7f8aa3;margin-left:auto;padding-left:14px}
  #panel{position:fixed;top:16px;right:18px;z-index:5;font-size:12px;
    background:rgba(10,14,28,.55);border:1px solid #1d2740;border-radius:10px;
    padding:10px 12px;backdrop-filter:blur(6px);min-width:148px}
  #panel label{display:flex;align-items:center;gap:7px;margin:5px 0;cursor:pointer;user-select:none}
  #panel button{margin-top:6px;width:100%;background:#16203a;color:#cdd6f4;
    border:1px solid #2a385c;border-radius:7px;padding:5px;cursor:pointer;font-size:12px}
  #panel button:hover{background:#1e2a4a}
  #hint{position:fixed;bottom:16px;right:18px;z-index:5;font-size:11px;color:#586079}
  #tip{position:fixed;z-index:9;pointer-events:none;display:none;max-width:280px;
    background:rgba(8,12,24,.95);border:1px solid #2a385c;border-radius:8px;
    padding:7px 10px;font-size:12px;box-shadow:0 6px 24px rgba(0,0,0,.5)}
  #tip .l{font-weight:600;font-size:13px}
  #tip .m{color:#7f8aa3;font-size:11px;margin-top:2px}
  #err{position:fixed;inset:0;z-index:20;display:none;place-items:center;text-align:center;
    padding:40px;background:#04060f}
  #err div{max-width:440px;color:#9aa3bd;font-size:14px;line-height:1.5}
</style>
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
}}
</script>
</head>
<body>
<canvas id="c"></canvas>
<div id="title"><h1>code solar system</h1><p></p></div>
<div id="panel">
  <label><input type="checkbox" id="spin" checked> auto-rotate</label>
  <label><input type="checkbox" id="alledges"> show all edges</label>
  <label><input type="checkbox" id="labels"> ring labels</label>
  <button id="reset">reset view</button>
</div>
<div id="legend"></div>
<div id="hint">drag to orbit · scroll to zoom · hover a planet</div>
<div id="tip"></div>
<div id="err"><div id="errmsg"></div></div>

<script type="module">
const DATA = __DATA_JSON__;

let THREE, OrbitControls, EffectComposer, RenderPass, UnrealBloomPass;
try {
  THREE = await import('three');
  ({ OrbitControls } = await import('three/addons/controls/OrbitControls.js'));
  ({ EffectComposer } = await import('three/addons/postprocessing/EffectComposer.js'));
  ({ RenderPass } = await import('three/addons/postprocessing/RenderPass.js'));
  ({ UnrealBloomPass } = await import('three/addons/postprocessing/UnrealBloomPass.js'));
} catch (e) {
  document.getElementById('err').style.display = 'grid';
  document.getElementById('errmsg').innerHTML =
    "Couldn't load Three.js from the CDN.<br>This page needs an internet connection the first time.<br><br>" +
    "<small>" + (e && e.message ? e.message : e) + "</small>";
  throw e;
}

const LAYERS = DATA.layers;
const ORDER = DATA.order;
const SUN_COLOR = DATA.sunColor;

document.title = DATA.project + ' — code solar system';
document.querySelector('#title h1').textContent = '🪐 ' + DATA.project + ' — code solar system';
document.querySelector('#title p').innerHTML =
  'Sun = <b>' + DATA.sunLabel + '</b> · rings = architecture layers · planet size = how connected a file is';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x04060f, 0.0016);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 4000);
const HOME = new THREE.Vector3(0, 46, 132);
camera.position.copy(HOME);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;
controls.minDistance = 14;
controls.maxDistance = 900;

scene.add(new THREE.AmbientLight(0x223044, 0.6));
const sunLight = new THREE.PointLight(0xfff2cc, 2600, 0, 1.7);
scene.add(sunLight);

function textSprite(text, { size = 46, color = '#dfe7ff' } = {}) {
  const pad = 16, font = `600 ${size}px -apple-system,Segoe UI,Roboto,sans-serif`;
  const m = document.createElement('canvas').getContext('2d');
  m.font = font;
  const w = Math.ceil(m.measureText(text).width) + pad * 2, h = size + pad * 2;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.font = font; ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 6;
  ctx.fillText(text, pad, h / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(w / h * (h / 46), (h / 46), 1);
  return sp;
}

function glowTexture() {
  const s = 128, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
  grd.addColorStop(0, 'rgba(255,240,200,1)');
  grd.addColorStop(0.25, 'rgba(255,213,79,.65)');
  grd.addColorStop(1, 'rgba(255,213,79,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
}

(function stars() {
  const N = 2000, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 380 + Math.random() * 950;
    const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    pos[i*3]   = r * Math.sin(ph) * Math.cos(th);
    pos[i*3+1] = r * Math.sin(ph) * Math.sin(th);
    pos[i*3+2] = r * Math.cos(ph);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xaab4d4, size: 1.1, sizeAttenuation: true, transparent: true, opacity: 0.85 })));
})();

// ---- sun (synthetic) ----
const sun = new THREE.Mesh(
  new THREE.SphereGeometry(6, 48, 48),
  new THREE.MeshBasicMaterial({ color: SUN_COLOR }));
scene.add(sun);
const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTexture(), color: 0xffffff, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false }));
sunGlow.scale.set(36, 36, 1);
scene.add(sunGlow);
const sunLabel = textSprite(DATA.sunLabel, { size: 52, color: '#fff1c2' });
sunLabel.position.set(0, 11, 0);
sunLabel.scale.multiplyScalar(3.2);
scene.add(sunLabel);

// ---- ring guides + ring labels ----
const ringLabels = [];
for (const key of ORDER) {
  const L = LAYERS[key];
  const pts = [];
  for (let i = 0; i <= 96; i++) {
    const a = i / 96 * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * L.r, 0, Math.sin(a) * L.r));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  scene.add(new THREE.LineLoop(geo, new THREE.LineBasicMaterial({
    color: L.color, transparent: true, opacity: 0.16 })));
  const lab = textSprite(L.name, { size: 40, color: '#' + L.color.toString(16).padStart(6, '0') });
  lab.position.set(0, 2.5, -L.r);
  lab.scale.multiplyScalar(2.4);
  lab.visible = false;
  scene.add(lab);
  ringLabels.push(lab);
}

// ---- planets ----
const planetGeo = new THREE.SphereGeometry(1, 14, 14);
const planets = [];
const meshByIdx = new Map();
const clock = new THREE.Clock();

DATA.nodes.forEach((n, idx) => {
  const L = LAYERS[n.layer] || LAYERS[ORDER[ORDER.length - 1]];
  const band = 5.5;
  const radius = L.r + (Math.random() - 0.5) * band * 2;
  const size = 0.4 + 0.16 * Math.sqrt(n.deg);
  const mat = new THREE.MeshStandardMaterial({
    color: L.color, emissive: L.color, emissiveIntensity: 0.28,
    roughness: 0.55, metalness: 0.1 });
  const mesh = new THREE.Mesh(planetGeo, mat);
  mesh.scale.setScalar(size);
  const tilt = new THREE.Euler((Math.random() - 0.5) * 0.34, 0, (Math.random() - 0.5) * 0.34);
  const p = {
    mesh, idx, layer: n.layer, baseEmissive: 0.28, size, radius, tilt,
    angle: Math.random() * Math.PI * 2,
    speed: 0.16 * L.speed * Math.pow(L.r / radius, 1.5) * (0.8 + Math.random() * 0.4),
  };
  mesh.userData.p = p;
  planets.push(p);
  meshByIdx.set(idx, mesh);
  scene.add(mesh);
});

function placePlanet(p, t) {
  const a = p.angle + t * p.speed;
  const v = new THREE.Vector3(Math.cos(a) * p.radius, 0, Math.sin(a) * p.radius);
  v.applyEuler(p.tilt);
  p.mesh.position.copy(v);
}

// ---- adjacency ----
const adj = new Map();
for (const [s, t] of DATA.edges) {
  (adj.get(s) || adj.set(s, []).get(s)).push(t);
  (adj.get(t) || adj.set(t, []).get(t)).push(s);
}

// ---- all-edges line set (toggle) ----
const allEdgesGeo = new THREE.BufferGeometry();
allEdgesGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DATA.edges.length * 6), 3));
const allEdges = new THREE.LineSegments(allEdgesGeo, new THREE.LineBasicMaterial({
  color: 0x39507a, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending }));
allEdges.visible = false;
scene.add(allEdges);

// ---- hover edges ----
const hoverGeo = new THREE.BufferGeometry();
const hoverLines = new THREE.LineSegments(hoverGeo, new THREE.LineBasicMaterial({
  color: 0xfff1c2, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending }));
scene.add(hoverLines);
let hovered = null;

// ---- bloom ----
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.5, 0.08));

// ---- raycast / tooltip ----
const ray = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerActive = false;
const tip = document.getElementById('tip');
addEventListener('pointermove', e => {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  pointerActive = true;
  tip.style.left = (e.clientX + 14) + 'px';
  tip.style.top = (e.clientY + 14) + 'px';
});

function setHover(p) {
  if (hovered === p) return;
  if (hovered) {
    hovered.mesh.material.emissiveIntensity = hovered.baseEmissive;
    hovered.mesh.scale.setScalar(hovered.size);
  }
  hovered = p;
  if (p) {
    p.mesh.material.emissiveIntensity = 1.0;
    p.mesh.scale.setScalar(p.size * 1.7);
    const n = DATA.nodes[p.idx];
    const conns = (adj.get(p.idx) || []).length;
    tip.innerHTML = `<div class="l">${n.label}</div>` +
      `<div class="m">${LAYERS[p.layer].name} · ${conns} connection${conns === 1 ? '' : 's'}` +
      (n.file ? ` · <span style="opacity:.7">${n.file}</span>` : '') + `</div>`;
    tip.style.display = 'block';
    document.body.style.cursor = 'pointer';
  } else {
    tip.style.display = 'none';
    document.body.style.cursor = 'default';
    hoverGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  }
}

function updateHoverLines() {
  if (!hovered) return;
  const nbrs = adj.get(hovered.idx) || [];
  const arr = new Float32Array(nbrs.length * 6);
  const o = hovered.mesh.position;
  nbrs.forEach((ni, i) => {
    const m = meshByIdx.get(ni); if (!m) return;
    arr[i*6] = o.x; arr[i*6+1] = o.y; arr[i*6+2] = o.z;
    arr[i*6+3] = m.position.x; arr[i*6+4] = m.position.y; arr[i*6+5] = m.position.z;
  });
  hoverGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  hoverGeo.attributes.position.needsUpdate = true;
}

function updateAllEdges() {
  if (!allEdges.visible) return;
  const arr = allEdgesGeo.attributes.position.array;
  DATA.edges.forEach(([s, t], i) => {
    const a = meshByIdx.get(s), b = meshByIdx.get(t);
    if (!a || !b) return;
    arr[i*6] = a.position.x; arr[i*6+1] = a.position.y; arr[i*6+2] = a.position.z;
    arr[i*6+3] = b.position.x; arr[i*6+4] = b.position.y; arr[i*6+5] = b.position.z;
  });
  allEdgesGeo.attributes.position.needsUpdate = true;
}

document.getElementById('spin').onchange = e => controls.autoRotate = e.target.checked;
document.getElementById('alledges').onchange = e => allEdges.visible = e.target.checked;
document.getElementById('labels').onchange = e => ringLabels.forEach(l => l.visible = e.target.checked);
document.getElementById('reset').onclick = () => {
  controls.target.set(0, 0, 0);
  camera.position.copy(HOME);
};

(function legend() {
  const counts = {};
  DATA.nodes.forEach(n => counts[n.layer] = (counts[n.layer] || 0) + 1);
  const el = document.getElementById('legend');
  const rows = [['sun', DATA.sunLabel + ' (sun)', SUN_COLOR, 1]];
  ORDER.forEach(k => rows.push([k, LAYERS[k].name, LAYERS[k].color, counts[k] || 0]));
  el.innerHTML = rows.map(([k, name, col, c]) => {
    const hex = '#' + col.toString(16).padStart(6, '0');
    return `<div class="row"><span class="dot" style="background:${hex};color:${hex}"></span>` +
           `<span>${name}</span><span class="ct">${c}</span></div>`;
  }).join('');
})();

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  for (const p of planets) placePlanet(p, t);
  sun.rotation.y = t * 0.15;
  sunGlow.scale.setScalar(36 + Math.sin(t * 1.6) * 1.5);

  if (pointerActive) {
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(planets.map(p => p.mesh), false)[0];
    setHover(hit ? hit.object.userData.p : null);
  }
  updateHoverLines();
  updateAllEdges();

  controls.update();
  composer.render();
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
</script>
</body>
</html>
"""

if __name__ == "__main__":
    main()
