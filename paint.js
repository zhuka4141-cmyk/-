import * as THREE from "three";
import { DecalGeometry } from "three/addons/geometries/DecalGeometry.js";

let nextPaintOrder = 21;

function paintOrder(order) {
  if (!Number.isSafeInteger(order) || order < 21) return nextPaintOrder++;
  nextPaintOrder = Math.max(nextPaintOrder, order + 1);
  return order;
}

function configurePaintMaterial(material, soft) {
  // All paint uses the transparent queue so opaque and soft strokes share order.
  material.transparent = true;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = "varying vec2 vPaintUv;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <uv_vertex>", "#include <uv_vertex>\nvPaintUv = uv;",
    );
    shader.fragmentShader = "varying vec2 vPaintUv;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <alphatest_fragment>",
      "#include <alphatest_fragment>\n" +
        (soft ? "" : "if (distance(vPaintUv, vec2(0.5)) > 0.5) discard;\n"),
    );
  };
  material.customProgramCacheKey = () => soft ? "paint-soft" : "paint-solid";
  return material;
}

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

function nearbyGeometry(part, point, size, normal) {
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
  const sourceNormals = source.attributes.normal;
  const targetNormal = normal?.clone().normalize();
  const triangleNormal = new THREE.Vector3();
  const vertexNormal = new THREE.Vector3();
  for (const triangle of candidates) {
    if (targetNormal && sourceNormals) {
      triangleNormal.set(0, 0, 0);
      for (let k = 0; k < 3; k++) {
        const i = source.index.getX(triangle * 3 + k);
        vertexNormal.fromBufferAttribute(sourceNormals, i);
        triangleNormal.add(vertexNormal);
      }
      if (
        triangleNormal.lengthSq() > 1e-8 &&
        triangleNormal.normalize().dot(targetNormal) < 0.55
      )
        continue;
    }
    for (let k = 0; k < 3; k++) {
      const i = source.index.getX(triangle * 3 + k);
      for (const [attribute, target] of [
        [source.attributes.position, positions],
        [source.attributes.normal, normals],
      ]) {
        target.push(attribute.getX(i), attribute.getY(i), attribute.getZ(i));
      }
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

export function createDecal(
  part,
  point,
  normal,
  color,
  diameter,
  texture,
  options = {},
) {
  const candidates = nearbyGeometry(part, point, diameter, normal);
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
  // Use a common outward offset so neighboring triangles cannot open seams.
  const offset = Math.max(part.geometry.boundingSphere.radius * 0.00002, diameter * 0.0002);
  const direction = normal.clone().normalize().multiplyScalar(offset);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    positions.setXYZ(i, positions.getX(i) + direction.x,
      positions.getY(i) + direction.y, positions.getZ(i) + direction.z);
  }
  const soft = options.soft !== false;
  const opacity = Number.isFinite(options.opacity)
    ? Math.min(1, Math.max(0.05, options.opacity))
    : 1;
  const material = configurePaintMaterial(new THREE.MeshStandardMaterial({
    color,
    map: soft ? texture : null,
    transparent: soft || opacity < 1,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    side: THREE.FrontSide,
    roughness: 0.82,
    metalness: 0,
  }), soft);
  const decal = new THREE.Mesh(geometry, material);
  decal.renderOrder = paintOrder(options.order);
  part.add(decal);
  return decal;
}

function mergeAttribute(geometries, name, itemSize) {
  const values = [];
  for (const geometry of geometries) {
    const attribute = geometry.attributes[name];
    if (!attribute) continue;
    for (let i = 0; i < attribute.count * itemSize; i++)
      values.push(attribute.array[i]);
  }
  return values.length ? new Float32Array(values) : null;
}

// A stroke can contain thousands of small decals. Keep its surface detail,
// but submit one lit mesh per touched part instead of one draw call per stamp.
export function consolidateStroke(stroke, texture) {
  if (!stroke?.meshes?.length) return stroke;
  stroke.order = stroke.order ?? stroke.meshes.reduce(
    (order, mesh) => Math.min(order, mesh.renderOrder), Infinity,
  );
  const groups = new Map();
  for (const mesh of stroke.meshes) {
    if (!mesh.parent) continue;
    if (!groups.has(mesh.parent)) groups.set(mesh.parent, []);
    groups.get(mesh.parent).push(mesh);
  }
  const pointsByPart = new Map();
  for (const stamp of stroke.stamps || []) {
    if (!pointsByPart.has(stamp.part)) pointsByPart.set(stamp.part, []);
    pointsByPart.get(stamp.part).push(stamp.p);
  }
  const mergedMeshes = [];
  for (const [parent, meshes] of groups) {
    const geometries = meshes.map((mesh) =>
      mesh.geometry.index
        ? mesh.geometry.toNonIndexed()
        : new THREE.BufferGeometry().copy(mesh.geometry),
    );
    const position = mergeAttribute(geometries, "position", 3);
    if (!position) {
      geometries.forEach((geometry) => geometry.dispose());
      continue;
    }
    const normal = mergeAttribute(geometries, "normal", 3);
    const uv = mergeAttribute(geometries, "uv", 2);
    const color = new Float32Array((position.length / 3) * 4);
    const paintColor = new THREE.Color(stroke.color);
    const strokeOpacity = Number.isFinite(stroke.opacity)
      ? Math.min(1, Math.max(0.05, stroke.opacity))
      : 1;
    const materialOpacity = Math.max(
      strokeOpacity,
      ...meshes.map((mesh) =>
        Number.isFinite(mesh.material.opacity) ? mesh.material.opacity : 1,
      ),
    );
    let vertex = 0;
    for (const [index, mesh] of meshes.entries()) {
      const count = geometries[index].attributes.position.count;
      const opacity = Number.isFinite(mesh.material.opacity)
        ? mesh.material.opacity
        : 1;
      for (let i = 0; i < count; i++) {
        color[vertex * 4] = paintColor.r;
        color[vertex * 4 + 1] = paintColor.g;
        color[vertex * 4 + 2] = paintColor.b;
        color[vertex * 4 + 3] = Math.min(1, opacity / materialOpacity);
        vertex++;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
    if (normal) geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normal, 3));
    if (uv) geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(color, 4));
    const material = configurePaintMaterial(new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: stroke.soft !== false ? texture : null,
      vertexColors: true,
      transparent: true,
      opacity: materialOpacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      side: THREE.FrontSide,
      roughness: 0.82,
      metalness: 0,
    }), stroke.soft !== false);
    const merged = new THREE.Mesh(geometry, material);
    merged.renderOrder = stroke.order;
    merged.userData.paintPoints = pointsByPart.get(parent.userData.id) || [];
    for (const mesh of meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    parent.add(merged);
    mergedMeshes.push(merged);
    geometries.forEach((geometry) => geometry.dispose());
  }
  stroke.meshes = mergedMeshes;
  return stroke;
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
    version: 3,
    modelKey,
    modelName,
    savedAt: Date.now(),
    strokes: strokes.map((stroke) => ({
      color: stroke.color,
      order: stroke.order,
      opacity: stroke.opacity ?? 1,
      tool: stroke.tool ?? "brush",
      soft: stroke.soft !== false,
      stamps: stroke.stamps,
    })),
  };
}

export function validateDrawing(data, modelKey, parts) {
  if (data?.version !== 2 && data?.version !== 3)
    throw new Error("涂鸦版本不兼容，请使用本版本导出的文件。");
  if (data.modelKey !== modelKey)
    throw new Error("涂鸦属于其他车型，无法应用到当前模型。");
  if (!Array.isArray(data.strokes))
    throw new Error("涂鸦笔画数据不正确。");
  const ids = new Set(parts.map((p) => p.userData.id));
  const vector = (value) =>
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e7,
    );
  for (const stroke of data.strokes) {
    if (
      !/^#[0-9a-f]{6}$/i.test(stroke?.color) ||
      !Array.isArray(stroke.stamps) ||
      !Number.isFinite(stroke.opacity ?? 1) ||
      stroke.opacity < 0 ||
      stroke.opacity > 1 ||
      !["brush", "eraser"].includes(stroke.tool ?? "brush") ||
      typeof (stroke.soft ?? true) !== "boolean"
    )
      throw new Error("涂鸦颜色或笔画格式不正确。");
    for (const stamp of stroke.stamps) {
      if (!stamp || !ids.has(stamp.part))
        throw new Error("涂鸦引用了不存在的零件。");
      if (
        !Number.isFinite(stamp.opacity ?? 1) ||
        stamp.opacity < 0 ||
        stamp.opacity > 1 ||
        !Number.isFinite(stamp.pressure ?? 0.65) ||
        stamp.pressure < 0 ||
        stamp.pressure > 1 ||
        !["brush", "eraser"].includes(stamp.tool ?? "brush") ||
        typeof (stamp.soft ?? true) !== "boolean"
      )
        throw new Error("涂鸦笔刷元数据不正确。");
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
      const stroke = {
        color: saved.color,
        order: Number.isSafeInteger(saved.order) && saved.order >= 21 ? saved.order : undefined,
        opacity: saved.opacity ?? 1,
        tool: saved.tool ?? "brush",
        soft: saved.soft !== false,
        stamps: [],
        meshes: [],
      };
      strokes.push(stroke);
      for (const stamp of saved.stamps) {
        const decal = createDecal(
          partById.get(stamp.part),
          new THREE.Vector3().fromArray(stamp.p),
          new THREE.Vector3().fromArray(stamp.n),
          saved.color,
          stamp.s,
          texture,
          {
            opacity: stamp.opacity ?? stroke.opacity,
            soft: stamp.soft ?? stroke.soft,
            order: stroke.order,
          },
        );
        if (decal) {
          stroke.meshes.push(decal);
          stroke.stamps.push(stamp);
        }
      }
      consolidateStroke(stroke, texture);
    }
    return strokes;
  } catch (error) {
    strokes.forEach(removeStroke);
    throw error;
  }
}
