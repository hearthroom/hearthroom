import { cpSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const stageSource = fileURLToPath(new URL("../../stage", import.meta.url));
const publicAssets = fileURLToPath(new URL("../public", import.meta.url));

export function publicSite(): Plugin {
  return {
    name: "hearthroom-public-site",
    load(id) {
      const fromStage = relative(stageSource, id);
      if (isAbsolute(id) && fromStage !== ".." && !fromStage.startsWith(".." + sep) && !isAbsolute(fromStage)) {
        this.error("Public site cannot bundle code from the Stage checkout");
      }
    },
    writeBundle(output) {
      if (!output.dir) this.error("Public site build requires an output directory");
      const sandbox = resolve(publicAssets, "sandbox");
      cpSync(publicAssets, output.dir, {
        recursive: true,
        force: false,
        filter: (file) => file !== sandbox,
      });
    },
  };
}
