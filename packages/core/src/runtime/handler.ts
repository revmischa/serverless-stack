import path from "path";
import fs from "fs-extra";
import os from "os";
import { State } from "../state";
import spawn from "cross-spawn";
import { Paths } from "../util";

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
  build?: Command;
  run: Command;
  watcher: {
    include: string[];
    ignore: string[];
  };
};

type Handler = (opts: Opts) => Instructions;

export const NodeHandler: Handler = (opts) => {
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
      include: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"].map((glob) =>
        path.resolve(path.join(opts.srcPath, glob))
      ),
      ignore: [],
    },
  };
};

export const GoHandler: Handler = (opts) => {
  const target = State.Function.artifactsPath(
    opts.root,
    path.join(
      path.dirname(opts.handler),
      path.basename(opts.handler).split(".")[0]
    )
  );
  return {
    build: {
      command: "go",
      args: ["build", "-o", target, opts.handler],
      env: {},
    },
    run: {
      command: target,
      args: [],
      env: {},
    },
    watcher: {
      include: [path.join(opts.srcPath, "**/*.go")],
      ignore: [],
    },
  };
};

export const PythonHandler: Handler = (opts) => {
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
  const dir = path.dirname(opts.handler);
  const [base, ext] = path.basename(opts.handler).split(".");
  const target = path.join(opts.srcPath, dir, base);

  return {
    run: {
      command:
        os.platform() === "win32" ? "python.exe" : opts.runtime.split(".")[0],
      args: [
        "-u",
        path.join(
          Paths.OWN_PATH,
          "../src",
          "runtime",
          "shells",
          "bootstrap.py"
        ),
        target.split(path.sep).join("."),
        opts.srcPath,
        ext,
      ],
      env: {
        PATH,
      },
    },
    watcher: {
      include: [path.join(opts.srcPath, "**/*.py")],
      ignore: [],
    },
  };
};

export const DotnetHandler: Handler = (opts: any) => {
  const dir = State.Function.artifactsPath(opts.root, opts.srcPath);
  const target = path.join(
    dir,
    path.basename(opts.handler).split(":")[0] + ".dll"
  );
  return {
    build: {
      command: "dotnet",
      args: [
        "publish",
        "--output",
        dir,
        "--configuration",
        "Release",
        "--framework",
        "netcoreapp3.1",
        "/p:GenerateRuntimeConfigurationFiles=true",
        "/clp:ForceConsoleColor",
        // warnings are not reported for repeated builds by default and this flag
        // does a clean before build. It takes a little longer to run, but the
        // warnings are consistently printed on each build.
        //"/target:Rebuild",
        "--self-contained",
        "false",
        // do not print "Build Engine version"
        "-nologo",
        // only print errors
        "--verbosity",
        process.env.DEBUG ? "minimal" : "quiet",
      ],
      env: {},
    },
    run: {
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
        target,
        opts.handler,
      ],
      env: {},
    },
    watcher: {
      include: [
        path.join(opts.srcPath, "**/*.cs"),
        path.join(opts.srcPath, "**/*.csx"),
      ],
      ignore: [],
    },
  };
};

export function build(opts: Opts) {
  const instructions = resolve(opts.runtime)(opts);
  if (!instructions.build) return;
  const result = spawn.sync(
    instructions.build.command,
    instructions.build.args,
    {
      env: {
        ...instructions.build.env,
        ...process.env,
      },
      cwd: opts.srcPath,
      stdio: "inherit",
    }
  );
  if (result.error) throw result.error;
}

export function resolve(runtime: string): Handler {
  if (runtime.startsWith("node")) return NodeHandler;
  if (runtime.startsWith("go")) return GoHandler;
  if (runtime.startsWith("python")) return PythonHandler;
  if (runtime.startsWith("dotnetcore")) return DotnetHandler;
  throw new Error(`Unknown runtime ${runtime}`);
}

export function instructions(opts: Opts) {
  const handler = resolve(opts.runtime);
  return handler(opts);
}
