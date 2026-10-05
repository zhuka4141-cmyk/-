import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import occtImport from "occt-import-js";
import * as THREE from "three";
import { buildModel, setExploded, updateExplosion } from "../model.js";

const occt = await occtImport();
const parsed = occt.ReadStepFile(
  new Uint8Array(readFileSync(new URL("../huh.step", import.meta.url))),
  {
    linearUnit: "millimeter",
    linearDeflectionType: "bounding_box_ratio",
    linearDeflection: 0.001,
    angularDeflection: 0.5,
  },
);

test("real CAD retains all entities and assigns requested detachable parts", () => {
  const model = buildModel(parsed, { knownModel: true });
  assert.equal(model.parts.length, 20);
  const counts = Object.fromEntries(
    ["frontWing", "rearWing", "wheels", "supports", "halo", "body"].map(
      (id) => [
        id,
        model.parts.filter((p) => p.userData.category === id).length,
      ],
    ),
  );
  assert.deepEqual(counts, {
    frontWing: 3,
    rearWing: 2,
    wheels: 5,
    supports: 7,
    halo: 1,
    body: 2,
  });
  assert.equal(
    model.parts.reduce((n, p) => n + p.geometry.index.count / 3, 0),
    parsed.meshes.reduce((n, p) => n + p.index.array.length / 3, 0),
  );
});

test("wheel selection moves both sides apart without moving other groups; decals follow and restoration is exact", () => {
  const model = buildModel(parsed, { knownModel: true });
  const decal = new THREE.Object3D();
  decal.position.set(1, 2, 3);
  model.parts[0].add(decal);
  setExploded(model, ["wheels"], 1);
  updateExplosion(model, 1, true);
  assert.ok(model.parts[0].position.x < 0);
  assert.ok(model.parts[1].position.x > 0);
  assert.deepEqual(model.parts[8].position.toArray(), [0, 0, 0]);
  model.root.updateMatrixWorld(true);
  assert.ok(decal.getWorldPosition(new THREE.Vector3()).x < 1);
  setExploded(model, [], 1);
  for (let i = 0; i < 240; i++) updateExplosion(model, 1 / 60, false);
  assert.ok(model.parts.every((p) => p.position.length() === 0));
  model.root.updateMatrixWorld(true);
  assert.deepEqual(
    decal.getWorldPosition(new THREE.Vector3()).toArray(),
    [1, 2, 3],
  );
});

test("unknown unnamed models remain intact and do not inherit the built-in car mapping", () => {
  const model = buildModel(
    {
      meshes: [parsed.meshes[0]],
      root: { name: "", meshes: [0], children: [] },
    },
    { knownModel: false },
  );
  assert.equal(model.parts[0].userData.category, "body");
  setExploded(model, ["wheels", "halo"], 1);
  updateExplosion(model, 1, true);
  assert.deepEqual(model.parts[0].position.toArray(), [0, 0, 0]);
});
