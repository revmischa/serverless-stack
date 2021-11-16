import { State } from "../state";
import path from "path";
import chokidar from "chokidar";
import { Opts } from "./handler";

export class Watcher {
  private handleChange?: (opts: Opts[]) => void;
  public onChange(input: (opts: Opts[]) => void) {
    this.handleChange = input;
  }

  public reload(root: string) {
    const funcs = State.Function.read(root);
    chokidar
      .watch(paths, {
        persistent: true,
        ignoreInitial: true,
        followSymlinks: false,
        disableGlobbing: false,
        ignored: ["**/node_modules/**", "**/.build/**", "**/.sst/**"],
        awaitWriteFinish: {
          pollInterval: 100,
          stabilityThreshold: 20,
        },
      })
      .on("change", (file, stats) => {
        const full = path.join(process.cwd(), file);
        const matched = funcs.filter((o) => {
          return full.startsWith(path.resolve(o.srcPath));
        });
        if (!matched.length) return;
        this.handleChange?.(matched);
      });
  }
}
