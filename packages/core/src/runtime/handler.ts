import path from "path";
import fs from "fs-extra";
import { State } from "../state";
import spawn from "cross-spawn";

export type Opts = {
  id: string;
  root: string;
  runtime: string;
  srcPath: string;
  handler: string;
};

type Command = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

type Instructions = {
  build: Command;
  run: Command;
  watcher: {
    include: string[];
    ignore: string[];
  };
};

type Handler = (opts: Opts) => Instructions;

function define<T extends Handler>(input: T) {
  return input;
}

export const NodeHandler = define((opts) => {
  const dir = path.dirname(opts.handler);
  const ext = path.extname(opts.handler);
  const base = path.basename(opts.handler).split(".")[0];
  const file = [".ts", ".tsx", ".js", ".jsx"]
    .map((ext) => path.join(dir, base + ext))
    .find((file) => {
      const p = path.join(opts.srcPath, file);
      return fs.existsSync(p);
    })!;

  const target = State.Function.artifactsPath(
    opts.root,
    path.join(path.dirname(file), base + ".js")
  );

  return {
    build: {
      command: "./node_modules/.bin/esbuild",
      args: [
        "--bundle",
        `--external:pg`,
        `--external:deasync`,
        `--external:kysely`,
        `--external:aws-sdk`,
        "--format=cjs",
        "--sourcemap",
        "--platform=node",
        "--target=node14",
        `--outfile=${target}`,
        path.join(opts.srcPath, file),
      ],
      env: {},
    },
    run: {
      command: "npx",
      args: ["aws-lambda-ric", target.replace(".js", ext)],
      env: {
        AWS_LAMBDA_NODEJS_USE_ALTERNATIVE_CLIENT_1: "true",
      },
    },
    watcher: {
      include: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
      ignore: ["**/node_modules/**"],
    },
  };
});

/*

export const NodeRunner: Handler = (opts) => {
  const handler = path
    .join(opts.transpiledHandler.srcPath, opts.transpiledHandler.entry)
    .replace(".js", "." + opts.transpiledHandler.handler);
  return {
    command: "npx",
    args: ["aws-lambda-ric", handler],
    env: {
      AWS_LAMBDA_NODEJS_USE_ALTERNATIVE_CLIENT_1: "true",
    },
  };
};

export const GoRunner: Handler = (opts) => {
  return {
    command: opts.transpiledHandler.entry,
    args: [],
    env: {},
  };
};

export const PythonRunner: Handler = (opts) => {
  const PATH = (() => {
    if (process.env.VIRTUAL_ENV) {
      const runtimeDir = os.platform() === "win32" ? "Scripts" : "bin";
      return [
        path.join(process.env.VIRTUAL_ENV, runtimeDir),
        path.delimiter,
        process.env.PATH,
      ].join("");
    }

    return process.env.PATH!;
  })();

  return {
    command:
      os.platform() === "win32" ? "python.exe" : opts.runtime.split(".")[0],
    args: [
      "-u",
      path.join(Paths.OWN_PATH, "../src", "runtime", "shells", "bootstrap.py"),
      path
        .join(opts.transpiledHandler.srcPath, opts.transpiledHandler.entry)
        .split(path.sep)
        .join("."),
      opts.transpiledHandler.srcPath,
      opts.transpiledHandler.handler,
    ],
    env: {
      PATH,
    },
  };
};

export const DotnetRunner: Handler = (opts) => {
  return {
    command: "dotnet",
    args: [
      "exec",
      path.join(
        Paths.OWN_PATH,
        "../src/",
        "runtime",
        "shells",
        "dotnet-bootstrap",
        "release",
        "dotnet-bootstrap.dll"
      ),
      opts.transpiledHandler.entry,
      opts.transpiledHandler.handler,
    ],
    env: {},
  };
};
*/

export function build(opts: Opts) {
  const instructions = resolve(opts.runtime)(opts);
  console.log(instructions.build.args.join(" "));
  spawn.sync(instructions.build.command, instructions.build.args, {
    env: instructions.build.env,
    cwd: opts.srcPath,
    stdio: "inherit",
  });
}

export function resolve(runtime: string): Handler {
  if (runtime.startsWith("node")) return NodeHandler;
  /*
  if (runtime.startsWith("go")) return GoRunner;
  if (runtime.startsWith("python")) return PythonRunner;
  if (runtime.startsWith("dotnetcore")) return DotnetRunner;
  */
  throw new Error(`Unknown runtime ${runtime}`);
}

export function instructions(opts: Opts) {
  const handler = resolve(opts.runtime);
  return handler(opts);
}
