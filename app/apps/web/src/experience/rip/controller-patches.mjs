/** App lifecycle fixes, also applied by sync-lab to avoid losing them on sync. */
export const controllerPatches = [
  // Regular Latin faces already come from the shell's full font CSS.
  [/import ["']@fontsource\/fraunces\/latin-600\.css["'];\s*/, ""],
  [/import ["']@fontsource\/fraunces\/latin-700\.css["'];\s*/, ""],
  [/import ["']@fontsource\/dm-sans\/latin-500\.css["'];\s*/, ""],
  [
    /const screen = this\.renderer\.compileAsync\(obj, this\.camera, this\.scene\);/,
    `const screen = this.shaders.run(async () => {
      await this.renderer.compileAsync(obj, this.camera, this.scene);
    });`,
  ],
  [
    /const bloom = this\.renderer\.compileAsync\(obj, this\.camera, this\.scene\);/,
    `const bloom = this.shaders.run(async () => {
      await this.renderer.compileAsync(obj, this.camera, this.scene);
    });`,
  ],
  [
    /import \* as THREE from (['"])three\1;/,
    '$&\nimport { ShaderLifetime } from "../shader-lifetime";',
  ],
  [
    /private destroyed = false;/,
    "$&\n  private shaders = new ShaderLifetime();",
  ],
  [
    /this\.ready = this\.init\(\);/,
    "$&\n    void this.ready.catch(this.renderFailed);",
  ],
  [
    /private async init\(\) \{/,
    `private renderFailed = () => {
    if (!this.destroyed)
      this.root.dispatchEvent(new Event("rip-render-error", { bubbles: true }));
  };

  $&`,
  ],
  [/await ensureFonts\(\);/, "$&\n    if (this.destroyed) return;"],
  [
    /const back = await this\.painter\.paint\(\{ kind: ["']back["'] \}\);/,
    "$&\n    if (this.destroyed) return;",
  ],
  [
    /await this\.compileDetached\(this\.machineHolder, \(\) => false\);/,
    "$&\n    if (this.destroyed) return;",
  ],
  [
    /for \(const c of this\.cards\) await this\.compileDetached\(c\.root, \(\) => false\);/,
    `for (const c of this.cards) {
      await this.compileDetached(c.root, () => false);
      if (this.destroyed) return;
    }`,
  ],
  [
    /this\.prebuildPacks\(\);/,
    "void this.prebuildPacks().catch(this.renderFailed);",
  ],
  [
    /const parent = obj\.parent;\s*parent\?\.remove\(obj\);/,
    `if (this.destroyed) return;
    return this.shaders.run(async () => {
    const parent = obj.parent;
    parent?.remove(obj);`,
  ],
  [
    /obj\.visible = visibleAfter\(\);\s*parent\?\.add\(obj\);\s*\}\s*\}/,
    `obj.visible = visibleAfter();
      parent?.add(obj);
    }
    });
  }`,
  ],
  [
    /await nextFrame\(\);\s*this\.renderer\.initTexture\(p\.texture\);/,
    "await nextFrame();\n      if (this.destroyed) return;\n      this.renderer.initTexture(p.texture);",
  ],
  [
    /\/\/ Warm the painting pipeline/,
    "if (this.destroyed) return;\n    // Warm the painting pipeline",
  ],
  [
    /await this\.revealIdle\(\);\s*this\.renderer\.initTexture\(closed\);/,
    `await this.revealIdle();
        if (this.destroyed) { asset.dispose(); return null; }
        this.renderer.initTexture(closed);`,
  ],
  [
    /await this\.compileDetached\(asset\.group, \(\) => false\);/,
    "$&\n        if (this.destroyed) { asset.dispose(); return null; }",
  ],
  [
    // The lab writes `p => …`; the app's formatter writes `(p) => …`.
    /this\.packs\.forEach\(\(?p\)? => p\.dispose\(\)\);/,
    `this.overlay.destroy();
    this.root.remove();
    // Stop input and rendering now; Three may still be polling shader programs.
    this.shaders.close(() => this.disposeResources());
  }

  private disposeResources() {
    this.packs.forEach((p) => p.dispose());`,
  ],
  [
    /this\.renderer\.dispose\(\);\s*this\.overlay\.destroy\(\);\s*this\.root\.remove\(\);/,
    "this.renderer.dispose();",
  ],
];

export function patchController(source) {
  for (const [pattern, replacement] of controllerPatches) {
    const next = source.replace(pattern, replacement);
    if (next === source)
      throw new Error(`Controller patch not applied: ${pattern}`);
    source = next;
  }
  return source;
}
