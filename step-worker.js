importScripts("./vendor/occt/occt-import-js.js");
let engine;
self.onmessage = async ({ data }) => {
  try {
    engine ||= occtimportjs({
      locateFile: (name) =>
        new URL(`./vendor/occt/${name}`, self.location.href).href,
    });
    const occt = await engine;
    const result = occt.ReadStepFile(new Uint8Array(data.buffer), data.params);
    if (!result.success || !result.meshes?.length)
      throw new Error("STEP 解析失败，文件可能损坏或没有实体。");
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
