import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  MODEL_FILENAME,
  MODEL_HASH,
  STEP_PARAMS,
  CATEGORIES,
  buildModel,
  setExploded,
  updateExplosion,
  disposeModel,
} from "./model.js";
import {
  createBrushTexture,
  createDecal,
  consolidateStroke,
  removeStroke,
  serializeDrawing,
  restoreDrawing,
} from "./paint.js";
import { classifyPointerInput } from "./interaction.js";
import { normalizePressure, coalescedPointerEvents } from "./interaction.js";

const $ = (id) => document.getElementById(id);
const viewer = $("viewer");
const state = {
  model: null,
  modelKey: "",
  modelName: MODEL_FILENAME,
  mode: "auto",
  selected: new Set(),
  strokes: [],
  redo: [],
  history: [],
  current: null,
  last: null,
  pointerId: null,
  busy: false,
  moving: false,
  stamps: 0,
  tool: "brush",
  softBrush: true,
  pressureEnabled: true,
  drawingReady: false,
};
const renderer = new THREE.WebGLRenderer({
  antialias: !(matchMedia("(pointer: coarse)").matches || navigator.hardwareConcurrency <= 4),
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute(
  "aria-label",
  "三维赛车；拖动旋转，滚轮缩放，选择画笔后拖动绘画",
);
viewer.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f151c);
const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.7;
scene.add(new THREE.HemisphereLight(0xffffff, 0x394958, 2.3));
const keyLight = new THREE.DirectionalLight(0xffffff, 3);
keyLight.position.set(-150, 300, 220);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0xc4ddff, 1.8);
rimLight.position.set(200, 80, -180);
scene.add(rimLight);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const texture = createBrushTexture();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let lastFrame = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  if (state.model && !state.current)
    state.moving = updateExplosion(state.model, dt, reducedMotion.matches);
  controls.update();
  renderer.render(scene, camera);
});

new ResizeObserver(() => {
  const { width, height } = viewer.getBoundingClientRect();
  renderer.setSize(width, height);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
  if (state.model) fitView();
}).observe(viewer);

function status(message, error = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
}

function updateUI() {
  const ready = Boolean(state.model) && !state.busy;
  document.querySelectorAll("[data-ready]").forEach((el) => {
    el.disabled = !ready;
  });
  $("loadModelBtn").disabled = state.busy;
  $("undoBtn").disabled = !ready || !state.strokes.length;
  $("redoBtn").disabled = !ready || !state.redo.length;
  let available = 0;
  for (const category of CATEGORIES) {
    const button = $(`part-${category.id}`);
    const exists = state.model?.parts.some(
      (part) => part.userData.category === category.id,
    );
    if (exists) available++;
    const active = state.selected.has(category.id);
    button.disabled = !ready || !exists;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.querySelector(".part-state").textContent = !exists
      ? "无部件"
      : active
        ? "已选择"
        : "拆开";
  }
  $("explodeAll").disabled =
    $("assembleAll").disabled =
    $("explodeDistance").disabled =
      !ready || !available;
  $("noParts").hidden = !state.model || Boolean(available);
  const separated =
    state.selected.size && Number($("explodeDistance").value) > 0;
  $("assemblyState").textContent = separated
    ? `${state.selected.size} 组拆开`
    : "已装配";
  $("viewLabel").firstChild.textContent = separated ? "拆解视图" : "整车视图";
}

for (const category of CATEGORIES) {
  const button = document.createElement("button");
  button.id = `part-${category.id}`;
  button.className = "part-toggle";
  button.type = "button";
  button.setAttribute("aria-label", category.label);
  button.setAttribute("aria-pressed", "false");
  button.innerHTML = `<span>${category.label}<small>${category.detail}</small></span><span class="part-state">拆开</span>`;
  button.addEventListener("click", () => {
    if (state.selected.has(category.id)) state.selected.delete(category.id);
    else state.selected.add(category.id);
    changeExplosion();
  });
  $("partControls").append(button);
}

function changeExplosion() {
  if (!state.model) return;
  endStroke();
  setExploded(
    state.model,
    state.selected,
    Number($("explodeDistance").value) / 100,
  );
  state.moving = true;
  updateUI();
  fitView();
}

function fitView() {
  const model = state.model;
  if (!model) return;
  const bounds = new THREE.Box3();
  for (const part of model.parts) {
    bounds.union(
      part.geometry.boundingBox
        .clone()
        .translate(
          part.userData.offset.clone().multiplyScalar(part.userData.target),
        ),
    );
  }
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
  const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
  const distance =
    (sphere.radius / Math.sin(Math.min(vertical, horizontal))) * 1.12;
  const direction = camera.position.clone().sub(controls.target);
  if (direction.lengthSq() < 0.01) direction.set(1, 0.65, 1.25);
  camera.position
    .copy(sphere.center)
    .add(direction.normalize().multiplyScalar(distance));
  controls.target.copy(sphere.center);
  controls.minDistance = model.radius * 0.05;
  controls.maxDistance = model.radius * 30;
  camera.near = Math.max(model.radius / 5000, 0.001);
  camera.far = Math.max(model.radius * 200, distance * 5);
  camera.updateProjectionMatrix();
  controls.update();
}

function setMode(mode) {
  endStroke();
  state.mode = mode;
  controls.enabled = mode !== "paint" && !state.busy;
  for (const [id, value] of [
    ["modeAuto", "auto"],
    ["modeOrbit", "orbit"],
    ["modePaint", "paint"],
  ]) {
    $(id).classList.toggle("active", mode === value);
    $(id).setAttribute("aria-pressed", String(mode === value));
  }
  renderer.domElement.style.cursor = mode === "paint" ? "crosshair" : "grab";
  $("hint").textContent =
    mode === "paint"
      ? "在部件表面拖动绘画 · 涂鸦随部件移动"
      : mode === "auto"
        ? "Apple Pencil 画笔 · 手指旋转/缩放"
        : "左键旋转 · 右键平移 · 滚轮缩放";
}

function clearStrokes() {
  state.strokes.forEach(removeStroke);
  state.strokes = [];
  state.stamps = 0;
  state.redo = [];
  state.history = [];
}

function parseStep(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./step-worker.js", import.meta.url));
    const done = (error, result) => {
      clearTimeout(timeout);
      worker.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    const timeout = setTimeout(
      () => done(new Error("解析超时，请使用较小的 STEP 文件重试。")),
      90000,
    );
    worker.onmessage = ({ data }) =>
      done(data.error ? new Error(data.error) : null, data.result);
    worker.onerror = () =>
      done(new Error("解析引擎加载失败，请检查 vendor 文件是否完整。"));
    worker.postMessage({ buffer, params: STEP_PARAMS }, [buffer]);
  });
}

async function loadModel(readBuffer, name) {
  if (state.busy) return;
  endStroke();
  flushDrawing();
  state.busy = true;
  controls.enabled = false;
  $("error").hidden = true;
  $("loading").hidden = false;
  $("loadingText").textContent = "正在读取车型…";
  updateUI();
  try {
    const buffer = await readBuffer();
    if (buffer.byteLength > 50 * 1024 * 1024)
      throw new Error("模型超过 50 MB，请先精简模型。");
    if (!crypto.subtle)
      throw new Error("请通过 HTTPS 或 localhost 打开，以便安全识别车型。");
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    $("loadingText").textContent = "正在解析 STEP 装配结构…";
    const parsed = await parseStep(buffer);
    $("loadingText").textContent = "正在构建零件…";
    const model = buildModel(parsed, { knownModel: hash === MODEL_HASH });
    state.drawingReady = false;
    clearStrokes();
    if (state.model) disposeModel(state.model);
    state.model = model;
    state.modelKey = hash;
    state.modelName = name;
    state.selected.clear();
    $("explodeDistance").value = "100";
    $("distanceValue").value = "100%";
    scene.add(model.root);
    camera.position.copy(model.center).add(new THREE.Vector3(1, 0.7, 1.3));
    controls.target.copy(model.center);
    fitView();
    $("modelName").textContent = name;
    $("modelInfo").textContent =
      `${model.parts.length} 个实体 · ${model.parts.reduce((n, part) => n + part.geometry.index.count / 3, 0).toLocaleString()} 个三角面`;
    setMode("auto");
    status("车型已加载，选择部件即可拆开");
    const saved = await readSaved(hash);
    if (saved) {
      try {
        applyDrawing(saved);
        state.drawingReady = true;
        status("车型已加载，已恢复本机涂鸦");
      } catch (error) {
        status(`车型已加载；缓存未恢复：${error.message}`, true);
      }
    } else state.drawingReady = true;
  } catch (error) {
    status(error.message, true);
    if (!state.model) {
      $("error").hidden = false;
      $("errorText").textContent =
        `${error.message} 可点击上方“导入模型”选择本地 STEP 文件。`;
    }
  } finally {
    state.busy = false;
    controls.enabled = state.mode !== "paint";
    $("loading").hidden = true;
    updateUI();
  }
}

const storageKey = (hash) => `car-paint-v2:${hash}`;
function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("stp-paint-db", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("kv"))
        request.result.createObjectStore("kv");
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
async function idb(operation, key, data) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      "kv",
      operation === "get" ? "readonly" : "readwrite",
    );
    const store = tx.objectStore("kv");
    const request = operation === "get" ? store.get(key) : store.put(data, key);
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error || new Error("保存失败"));
    };
  });
}
const SAVE_DELAY_MS = 400;
let saveQueue = Promise.resolve();
let saveTimer = null;
let pendingSave = null;
function flushDrawing() {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!pendingSave) return saveQueue;
  const pending = pendingSave;
  pendingSave = null;
  const data = serializeDrawing(
    pending.modelKey,
    pending.modelName,
    pending.strokes,
  );
  let localSaved = false;
  try {
    localStorage.setItem(pending.key, JSON.stringify(data));
    localSaved = true;
  } catch {
    /* IndexedDB provides the larger fallback. */
  }
  saveQueue = saveQueue.then(async () => {
    try {
      await idb("put", pending.key, data);
    } catch {
      if (!localSaved) status("自动保存失败，请点击“导出涂鸦”保留作品。", true);
    }
  });
  return saveQueue;
}
function saveDrawing() {
  if (!state.model) return;
  state.drawingReady = true;
  pendingSave = {
    key: storageKey(state.modelKey),
    modelKey: state.modelKey,
    modelName: state.modelName,
    strokes: state.strokes,
  };
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushDrawing, SAVE_DELAY_MS);
}
async function readSaved(hash) {
  flushDrawing();
  await saveQueue;
  const saved = [];
  try {
    const data = await idb("get", storageKey(hash));
    if (data) saved.push(data);
  } catch {
    /* Fall back to localStorage. */
  }
  try {
    const data = JSON.parse(localStorage.getItem(storageKey(hash)));
    if (data) saved.push(data);
  } catch {
    /* An empty or unavailable cache is not a model error. */
  }
  return saved.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0];
}
function applyDrawing(data) {
  const restored = restoreDrawing(
    data,
    state.modelKey,
    state.model.parts,
    texture,
  );
  clearStrokes();
  state.strokes = restored;
  state.stamps = restored.reduce((n, stroke) => n + stroke.stamps.length, 0);
  updateUI();
}
function restoreStroke(stroke) {
  return restoreDrawing(
    {
      version: 3,
      modelKey: state.modelKey,
      strokes: [
        {
          color: stroke.color,
          opacity: stroke.opacity,
          tool: stroke.tool,
          soft: stroke.soft,
          stamps: stroke.stamps,
        },
      ],
    },
    state.modelKey,
    state.model.parts,
    texture,
  )[0];
}

function surface(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);
  state.model.root.updateMatrixWorld(true);
  const hit = raycaster.intersectObjects(state.model.parts, false)[0];
  if (!hit) return null;
  $("paintTarget").textContent = hit.object.name || "当前零件";
  return {
    part: hit.object,
    p: hit.object.worldToLocal(hit.point.clone()),
    n: hit.face.normal.clone().normalize(),
  };
}
function updateBrushCursor(event) {
  const cursor = $("brushCursor");
  const visible =
    state.mode === "paint" ||
    (state.mode === "auto" && event.pointerType === "pen");
  if (!visible) {
    cursor.style.display = "none";
    return;
  }
  const rect = renderer.domElement.getBoundingClientRect();
  cursor.style.display = "block";
  cursor.style.left = `${event.clientX - rect.left}px`;
  cursor.style.top = `${event.clientY - rect.top}px`;
  const pressure = normalizePressure(event, state.pressureEnabled);
  const pixels = Math.max(
    12,
    Math.min(
      120,
      12 +
        Number($("brushSize").value) *
          0.55 *
          (state.pressureEnabled ? 0.55 + pressure * 0.75 : 1),
    ),
  );
  cursor.style.width = `${pixels}px`;
  cursor.style.height = `${pixels}px`;
  cursor.style.opacity = `${0.45 + pressure * 0.5}`;
  $("pressureReadout").textContent = state.pressureEnabled
    ? `压力 ${Math.round(pressure * 100)}%`
    : "压力关闭";
}
function brushSize() {
  return Math.max(
    ((state.model.radius * Number($("brushSize").value)) / 100) * 0.08,
    state.model.radius * 0.0008,
  );
}
function screenDistance(part, a, b) {
  const first = part.localToWorld(a.clone()).project(camera);
  const second = part.localToWorld(b.clone()).project(camera);
  return Math.hypot(
    ((first.x - second.x) * renderer.domElement.clientWidth) / 2,
    ((first.y - second.y) * renderer.domElement.clientHeight) / 2,
  );
}
function stamp(hit) {
  const pressure = Number.isFinite(hit.pressure)
    ? hit.pressure
    : state.current.pressure;
  const size =
    state.current.baseSize *
    (state.pressureEnabled ? 0.55 + pressure * 0.75 : 1);
  const opacity = Math.min(
    1,
    state.current.baseOpacity *
      (state.pressureEnabled ? 0.55 + pressure * 0.6 : 1),
  );
  if (state.current.tool === "eraser") {
    eraseAt(hit);
    return;
  }
  const mesh = createDecal(
    hit.part,
    hit.p,
    hit.n,
    state.current.color,
    size,
    texture,
    { opacity, soft: state.softBrush },
  );
  if (!mesh) return;
  state.current.meshes.push(mesh);
  state.current.stamps.push({
    part: hit.part.userData.id,
    p: hit.p.toArray(),
    n: hit.n.toArray(),
    s: size,
    opacity,
    tool: state.current.tool,
    soft: state.softBrush,
    pressure,
  });
  state.stamps++;
}
function eraseAt(hit) {
  const worldPoint = hit.part.localToWorld(hit.p.clone());
  const threshold = state.current.baseSize * 1.4;
  for (let i = state.strokes.length - 1; i >= 0; i--) {
    const stroke = state.strokes[i];
    if (!stroke.meshes.some((mesh) => mesh.parent === hit.part)) continue;
    const close = stroke.meshes.some((mesh) => {
      const points = mesh.userData.paintPoints || [];
      return points.length
        ? points.some((point) =>
            hit.part
              .localToWorld(new THREE.Vector3().fromArray(point))
              .distanceTo(worldPoint) <= threshold,
          )
        : new THREE.Box3()
            .setFromObject(mesh)
            .getCenter(new THREE.Vector3())
            .distanceTo(worldPoint) <= threshold;
    });
    if (!close) continue;
    state.strokes.splice(i, 1);
    state.history.push({ type: "erase", stroke });
    state.redo = [];
    state.stamps -= stroke.stamps.length;
    removeStroke(stroke);
    saveDrawing();
    status("已擦除一笔涂鸦");
    break;
  }
}
renderer.domElement.addEventListener(
  "pointerdown",
  (event) => {
    if (state.mode === "auto")
      controls.enabled = event.pointerType !== "pen" && !state.busy;
    const inputMode = classifyPointerInput(event, state.mode);
    if (inputMode !== "paint" || !state.model || state.busy || state.current)
      return;
    if (state.moving) updateExplosion(state.model, 1, true);
    const hit = surface(event);
    if (!hit) return;
    event.preventDefault();
    renderer.domElement.setPointerCapture(event.pointerId);
    state.pointerId = event.pointerId;
    state.inputMode = inputMode;
    controls.enabled = false;
    state.current = {
      color: $("brushColor").value,
      opacity: Number($("brushOpacity").value) / 100,
      baseSize: brushSize(),
      baseOpacity: Number($("brushOpacity").value) / 100,
      tool: state.tool,
      pressure: normalizePressure(event, state.pressureEnabled),
      meshes: [],
      stamps: [],
    };
    state.last = hit;
    stamp({ ...hit, pressure: state.current.pressure });
  },
  true,
);
renderer.domElement.addEventListener("pointermove", (event) => {
  updateBrushCursor(event);
  if (!state.current || event.pointerId !== state.pointerId) return;
  for (const sample of coalescedPointerEvents(event)) paintSample(sample);
});
renderer.domElement.addEventListener("pointerleave", () => {
  $("brushCursor").style.display = "none";
});
function paintSample(event) {
  if (!state.current || event.pointerId !== state.pointerId) return;
  const hit = surface(event);
  if (!hit) {
    state.last = null;
    return;
  }
  const previous = state.last;
  if (previous && previous.part === hit.part && previous.n.dot(hit.n) > 0.5) {
    const distance = previous.p.distanceTo(hit.p);
    const pixels = screenDistance(hit.part, previous.p, hit.p);
    const spacing = state.current.baseSize * 0.25;
    if (distance < spacing * 0.7 && pixels < 2) return;
    if (distance < state.current.baseSize * 8) {
      const steps = Math.min(
        48,
        Math.max(1, Math.ceil(Math.max(distance / spacing, pixels / 6))),
      );
      for (let i = 1; i <= steps; i++)
        stamp({
          part: hit.part,
          p: previous.p.clone().lerp(hit.p, i / steps),
          n: previous.n
            .clone()
            .lerp(hit.n, i / steps)
            .normalize(),
          pressure: normalizePressure(event, state.pressureEnabled),
        });
    } else stamp(hit);
  } else
    stamp({
      ...hit,
      pressure: normalizePressure(event, state.pressureEnabled),
    });
  state.last = hit;
}
function endStroke() {
  if (!state.current) return;
  if (state.current.stamps.length) {
    consolidateStroke(state.current, texture);
    state.strokes.push(state.current);
    state.history.push({ type: "add", stroke: state.current });
    state.redo = [];
    saveDrawing();
    status(`已记录 ${state.strokes.length} 笔涂鸦`);
  } else removeStroke(state.current);
  state.current = null;
  state.last = null;
  if (
    state.pointerId !== null &&
    renderer.domElement.hasPointerCapture(state.pointerId)
  )
    renderer.domElement.releasePointerCapture(state.pointerId);
  state.pointerId = null;
  state.inputMode = null;
  controls.enabled = state.mode !== "paint" && !state.busy;
  updateUI();
}
for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
  renderer.domElement.addEventListener(event, endStroke);
window.addEventListener("blur", endStroke);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) endStroke();
});

$("explodeAll").onclick = () => {
  state.selected = new Set(
    CATEGORIES.filter((c) =>
      state.model.parts.some((p) => p.userData.category === c.id),
    ).map((c) => c.id),
  );
  if (Number($("explodeDistance").value) === 0) {
    $("explodeDistance").value = "100";
    $("distanceValue").value = "100%";
  }
  changeExplosion();
};
$("assembleAll").onclick = () => {
  state.selected.clear();
  changeExplosion();
};
$("explodeDistance").oninput = () => {
  $("distanceValue").value = `${$("explodeDistance").value}%`;
  changeExplosion();
};
$("fitBtn").onclick = fitView;
$("modeAuto").onclick = () => setMode("auto");
$("modeOrbit").onclick = () => setMode("orbit");
$("modePaint").onclick = () => setMode("paint");
$("brushSize").oninput = () => {
  $("brushSizeValue").value = $("brushSize").value;
};
$("brushOpacity").oninput = () => {
  $("brushOpacityValue").value = `${$("brushOpacity").value}%`;
};
$("pressureToggle").onchange = () => {
  state.pressureEnabled = $("pressureToggle").checked;
};
function setBrushColor(value) {
  const normalized = String(value).trim().toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(normalized)) return false;
  $("brushColor").value = normalized;
  $("colorHex").value = normalized;
  document.querySelectorAll(".color-swatch").forEach((swatch) => {
    const active = swatch.dataset.color.toUpperCase() === normalized;
    swatch.classList.toggle("active", active);
    swatch.setAttribute("aria-selected", String(active));
  });
  return true;
}
document.querySelectorAll(".color-swatch").forEach((swatch) => {
  swatch.addEventListener("click", () => setBrushColor(swatch.dataset.color));
});
$("brushColor").addEventListener("input", (event) =>
  setBrushColor(event.target.value),
);
$("colorHex").addEventListener("input", (event) => {
  if (/^#[0-9A-F]{6}$/i.test(event.target.value.trim()))
    setBrushColor(event.target.value);
});
$("colorHex").addEventListener("blur", () =>
  setBrushColor($("brushColor").value),
);
setBrushColor($("brushColor").value);
$("toolBrush").onclick = () => {
  state.tool = "brush";
  $("toolBrush").classList.add("active");
  $("toolEraser").classList.remove("active");
};
$("toolEraser").onclick = () => {
  state.tool = "eraser";
  $("toolEraser").classList.add("active");
  $("toolBrush").classList.remove("active");
};
$("hardBrush").onclick = () => {
  state.softBrush = !state.softBrush;
  $("hardBrush").classList.toggle("active", !state.softBrush);
  $("hardBrush").textContent = state.softBrush ? "硬边" : "柔边";
};
$("undoBtn").onclick = () => {
  endStroke();
  const action = state.history.pop();
  if (!action) return;
  if (action.type === "add") {
    const index = state.strokes.indexOf(action.stroke);
    if (index >= 0) state.strokes.splice(index, 1);
    state.stamps -= action.stroke.stamps.length;
    removeStroke(action.stroke);
  } else {
    action.stroke = restoreStroke(action.stroke);
    state.strokes.push(action.stroke);
    state.stamps += action.stroke.stamps.length;
  }
  state.redo.push(action);
  saveDrawing();
  updateUI();
  status("已撤销上一笔");
};
$("redoBtn").onclick = () => {
  endStroke();
  const action = state.redo.pop();
  if (!action) return;
  if (action.type === "add") {
    action.stroke = restoreStroke(action.stroke);
    state.strokes.push(action.stroke);
    state.stamps += action.stroke.stamps.length;
  } else {
    const index = state.strokes.indexOf(action.stroke);
    if (index >= 0) state.strokes.splice(index, 1);
    state.stamps -= action.stroke.stamps.length;
    removeStroke(action.stroke);
  }
  state.history.push(action);
  saveDrawing();
  updateUI();
  status("已重做上一笔");
};
$("resetBtn").onclick = () => {
  endStroke();
  if (
    state.strokes.length &&
    !confirm("清空当前车型的全部涂鸦？此操作无法撤销。")
  )
    return;
  clearStrokes();
  saveDrawing();
  updateUI();
  status("已清空涂鸦");
};
$("saveBtn").onclick = () => {
  endStroke();
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          serializeDrawing(state.modelKey, state.modelName, state.strokes),
        ),
      ],
      { type: "application/json" },
    ),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${state.modelName.replace(/\.(step|stp)$/i, "")}-painting.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  status("涂鸦已导出");
};
$("openBtn").onclick = () => $("drawingFile").click();
$("drawingFile").onchange = async () => {
  const file = $("drawingFile").files[0];
  $("drawingFile").value = "";
  if (!file || !state.model || state.busy) return;
  endStroke();
  try {
    applyDrawing(JSON.parse(await file.text()));
    saveDrawing();
    status("涂鸦已导入");
  } catch (error) {
    status(`导入失败：${error.message}`, true);
  }
};
$("loadModelBtn").onclick = () => $("modelFile").click();
$("modelFile").onchange = () => {
  const file = $("modelFile").files[0];
  $("modelFile").value = "";
  if (!file) return;
  if (!/\.(step|stp)$/i.test(file.name)) {
    status("请选择 .step 或 .stp 文件。", true);
    return;
  }
  loadModel(() => file.arrayBuffer(), file.name);
};
function loadDefault() {
  return loadModel(async () => {
    const response = await fetch(new URL(MODEL_FILENAME, import.meta.url));
    if (!response.ok)
      throw new Error(`车型下载失败（HTTP ${response.status}）。`);
    return response.arrayBuffer();
  }, MODEL_FILENAME);
}
$("retryBtn").onclick = loadDefault;
window.addEventListener("beforeunload", () => {
  endStroke();
  if (!state.model || !state.drawingReady) return;
  flushDrawing();
});
setMode("auto");
updateUI();
loadDefault();
