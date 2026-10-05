import { copyFile, mkdir } from "node:fs/promises";

const files = [
  ["three/build/three.module.js", "three/three.module.js"],
  [
    "three/examples/jsm/controls/OrbitControls.js",
    "three/addons/controls/OrbitControls.js",
  ],
  [
    "three/examples/jsm/geometries/DecalGeometry.js",
    "three/addons/geometries/DecalGeometry.js",
  ],
  ["three/LICENSE", "three/LICENSE"],
  ...[
    "occt-import-js.js",
    "occt-import-js.wasm",
    "license.occt.txt",
    "license.occt-import-js.txt",
  ].map((f) => [`occt-import-js/dist/${f}`, `occt/${f}`]),
];
for (const [source, destination] of files) {
  const path = new URL(`../vendor/${destination}`, import.meta.url);
  await mkdir(new URL(".", path), { recursive: true });
  await copyFile(new URL(`../node_modules/${source}`, import.meta.url), path);
}
console.log("Pinned browser dependencies and licenses copied to vendor/.");
