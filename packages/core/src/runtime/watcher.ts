import { State } from "../state";
import chokidar from "chokidar";
import * as Handler from "./handler";
import pm from "picomatch";

export class Watcher {
  private handleChange?: (opts: Handler.Opts[]) => void;

  public onChange(input: (opts: Handler.Opts[]) => void) {
    this.handleChange = input;
  }

  public reload(root: string) {
    const funcs = State.Function.read(root);
    const instructions = funcs.map(
      (f) => [f, Handler.instructions(f)] as const
    );
    const paths = instructions.flatMap(([_, i]) => i.watcher.include);
    const matchers = instructions.map(
      ([f, i]) => [f, i.watcher.include.map((p) => pm(p))] as const
    );

    chokidar
      .watch(paths, {
        persistent: true,
        ignoreInitial: true,
        followSymlinks: false,
        disableGlobbing: false,
        ignored: ["**/.build/**", "**/.sst/**"],
        awaitWriteFinish: {
          pollInterval: 100,
          stabilityThreshold: 20,
        },
      })
      .on("change", (file) => {
        const funcs = matchers
          .filter(([_, matchers]) => matchers.some((m) => m(file)))
          .map(([f]) => f);
        this.handleChange?.(funcs);
      });
  }
}
