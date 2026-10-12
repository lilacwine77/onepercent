import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { PackTurntable } from "../src/pack-turntable-source.js";

window.buildTurntableMaster = async () => {
  const container = document.createElement("div");
  container.style.cssText = "width:900px;height:900px";
  document.body.appendChild(container);
  const pack = new PackTurntable({ container });
  await pack.ready;
  pack.setProgress(0);
  const buffer = await new GLTFExporter().parseAsync(pack.asset.group, {
    binary: true,
    includeCustomExtensions: true,
  });
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  const names = pack.meshes.map((mesh) => mesh.name);
  pack.destroy();
  container.remove();
  return { base64: btoa(binary), names };
};
