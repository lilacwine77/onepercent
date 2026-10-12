import { TextureLoader } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CspMeshoptDecoder } from "./meshopt";
/**
 * A GLTFLoader that works under the production CSP: meshopt decodes without
 * WebAssembly (no 'wasm-unsafe-eval'), and embedded images load through <img>
 * from blob: URLs (img-src allows blob:) instead of fetch() (connect-src 'self').
 */
export function cspGltfLoader() {
  return new GLTFLoader()
    .setMeshoptDecoder(
      CspMeshoptDecoder as unknown as Parameters<
        GLTFLoader["setMeshoptDecoder"]
      >[0],
    )
    .register((parser) => {
      const loader = new TextureLoader(parser.options.manager);
      loader.setCrossOrigin(parser.options.crossOrigin ?? "anonymous");
      (parser as unknown as { textureLoader: TextureLoader }).textureLoader =
        loader;
      return { name: "onepercent_csp_textures" };
    });
}
