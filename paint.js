import * as THREE from "three";
import { DecalGeometry } from "three/addons/geometries/DecalGeometry.js";

export const MAX_STAMPS = 6000;

export function createBrushTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "#fff");
  gradient.addColorStop(0.5, "#fff");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

// A lazy, per-part index never needs rebuilding when its part moves.
function indexPart(part) {
  const geometry = part.geometry;
  geometry.computeBoundingSphere();
  const cellSize = Math.max(geometry.boundingSphere.radius * 0.08, 0.001);
  const cells = new Map();
  const large = [];
  const vertices = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];
  for (let triangle = 0; triangle < geometry.index.count / 3; triangle++) {
    vertices.forEach((v, k) =>
      v.fromBufferAttribute(
        geometry.attributes.position,
        geometry.index.getX(triangle * 3 + k),
      ),
    );
    const min = [0, 1, 2].map((axis) =>
      Math.floor(
        Math.min(...vertices.map((v) => v.getComponent(axis))) / cellSize,
      ),
    );
    const max = [0, 1, 2].map((axis) =>
      Math.floor(
        Math.max(...vertices.map((v) => v.getComponent(axis))) / cellSize,
      ),
    );
    if (
      (max[0] - min[0] + 1) * (max[1] - min[1] + 1) * (max[2] - min[2] + 1) >
      512
    ) {
      large.push(triangle);
      continue;
    }
    for (let x = min[0]; x <= max[0]; x++)
      for (let y = min[1]; y <= max[1]; y++)
        for (let z = min[2]; z <= max[2]; z++) {
          const key = `${x},${y},${z}`;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(triangle);
        }
  }
  return { cells, large, cellSize };
}

function nearbyGeometry(part, point, size) {
  const index = (part.userData.paintIndex ||= indexPart(part));
  const { cells, large, cellSize } = index;
  const extent = size * 0.9;
  const min = point.toArray().map((v) => Math.floor((v - extent) / cellSize));
  const max = point.toArray().map((v) => Math.floor((v + extent) / cellSize));
  const candidates = new Set(large);
  const volume =
    (max[0] - min[0] + 1) * (max[1] - min[1] + 1) * (max[2] - min[2] + 1);
  const source = part.geometry;
  if (volume > 4096) {
    for (let i = 0; i < source.index.count / 3; i++) candidates.add(i);
  } else {
    for (let x = min[0]; x <= max[0]; x++)
      for (let y = min[1]; y <= max[1]; y++)
        for (let z = min[2]; z <= max[2]; z++) {
          for (const triangle of cells.get(`${x},${y},${z}`) || [])
            candidates.add(triangle);
        }
  }
  const positions = [];
  const normals = [];
  for (const triangle of candidates)
    for (let k = 0; k < 3; k++) {
      const i = source.index.getX(triangle * 3 + k);
      for (const [attribute, target] of [
        [source.attributes.position, positions],
        [source.attributes.normal, normals],
      ]) {
        target.push(attribute.getX(i), attribute.getY(i), attribute.getZ(i));
      }
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

export function createDecal(part, point, normal, color, diameter, texture) {
  const candidates = nearbyGeometry(part, point, diameter);
  const tempMesh = new THREE.Mesh(candidates, part.material);
  const orientation = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      normal.clone().normalize(),
    ),
  );
  let geometry;
  try {
    geometry = new DecalGeometry(
      tempMesh,
      point,
      orientation,
      new THREE.Vector3(diameter, diameter, diameter * 0.6),
    );
  } finally {
    candidates.dispose();
  }
  if (!geometry.attributes.position.count) {
    geometry.dispose();
    return null;
  }
  const material = new THREE.MeshBasicMaterial({
    color,
    map: texture,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const decal = new THREE.Mesh(geometry, material);
  decal.renderOrder = 20;
  part.add(decal);
  return decal;
}

export function removeStroke(stroke) {
  for (const mesh of stroke.meshes) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
}

export function serializeDrawing(modelKey, modelName, strokes) {
  return {
    version: 2,
    modelKey,
    modelName,
    savedAt: Date.now(),
    strokes: strokes.map((stroke) => ({
      color: stroke.color,
      stamps: stroke.stamps,
    })),
  };
}

export function validateDrawing(data, modelKey, parts) {
  if (data?.version !== 2)
    throw new Error("涂鸦版本不兼容，请使用本版本导出的文件。");
  if (data.modelKey !== modelKey)
    throw new Error("涂鸦属于其他车型，无法应用到当前模型。");
  if (!Array.isArray(data.strokes) || data.strokes.length > MAX_STAMPS)
    throw new Error("涂鸦笔画数据不正确。");
  const ids = new Set(parts.map((p) => p.userData.id));
  let total = 0;
  const vector = (value) =>
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e7,
    );
  for (const stroke of data.strokes) {
    if (!/^#[0-9a-f]{6}$/i.test(stroke?.color) || !Array.isArray(stroke.stamps))
      throw new Error("涂鸦颜色或笔画格式不正确。");
    total += stroke.stamps.length;
    if (total > MAX_STAMPS)
      throw new Error(`涂鸦超过 ${MAX_STAMPS} 个笔刷印记，请分批绘制。`);
    for (const stamp of stroke.stamps) {
      if (!stamp || !ids.has(stamp.part))
        throw new Error("涂鸦引用了不存在的零件。");
      if (
        !vector(stamp.p) ||
        !vector(stamp.n) ||
        Math.hypot(...stamp.n) < 0.01 ||
        !Number.isFinite(stamp.s) ||
        stamp.s <= 0 ||
        stamp.s > 1e5
      )
        throw new Error("涂鸦坐标或笔刷尺寸不正确。");
    }
  }
}

export function restoreDrawing(data, modelKey, parts, texture) {
  validateDrawing(data, modelKey, parts);
  const partById = new Map(parts.map((p) => [p.userData.id, p]));
  const strokes = [];
  try {
    for (const saved of data.strokes) {
      const stroke = { color: saved.color, stamps: [], meshes: [] };
      strokes.push(stroke);
      for (const stamp of saved.stamps) {
        const decal = createDecal(
          partById.get(stamp.part),
          new THREE.Vector3().fromArray(stamp.p),
          new THREE.Vector3().fromArray(stamp.n),
          saved.color,
          stamp.s,
          texture,
        );
        if (decal) {
          stroke.meshes.push(decal);
          stroke.stamps.push(stamp);
        }
      }
    }
    return strokes;
  } catch (error) {
    strokes.forEach(removeStroke);
    throw error;
  }
}
