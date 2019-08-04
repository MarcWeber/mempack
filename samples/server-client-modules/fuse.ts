import console = require("console");
import * as fs from "fs";
import * as path from "path"
import { newGlobalState } from "src/GlobalState";
import { foo } from "tsmono/links/fuse-box/playground/bundle/src/circular/foo";
import { exception_to_str } from "ttslib/exception";
import * as ts from "typescript"
import { CTX, defaultResolveImplementation, dependencyTree } from "../../src/dependencies";
import * as Mempack from "../../src/Mempack"

const gS = newGlobalState({watch: true})
const ss = gS.snaphshottedCache()

const clientConfig: Mempack.ContextUser = {
  entryPoints: ["main.ts"],
  node_modules: ["../../node_modules"],
  tsconfig: "../../tsconfig.json",
}
const config = Mempack.resolveContext(() => clientConfig)()

console.log("config", config);

const graph_of = async (entryPoint: string) => {
  const ss = gS.snaphshottedCache()

  const resolveOptions = {
    node_modules: config.node_modules,
    target: "node" as "node",
    tsconfig: config.tsconfig,
  }

  const p = "client.ts"
  const l = []
  for (const v of [1, 2, 3, 4, 5, 6]) {
    l.push(`\n kind ${v}\n`)
    const transpiled = (await ss.transpiled({cacheIdOfPath: await ss.hash(p), moduleKind: v})).item
    // const transpiled = ts.transpileModule(fs.readFileSync(file.path, "utf8"), { compilerOptions: { module: v } })
    l.push(transpiled)
    l.push("\n===\n")
  }
  process.stdout.write(l.join("\n"))
  return

  const gtx: CTX = {
    ss: gS.snaphshottedCache(),
    event_file_found: [],
    log: console.log.bind(console),
    throwError: false, // TODO: should be early abort
    // isFile: (path:string) => Promise<boolean>
    // log: (msg: string) => {},
    // throwError: false,
    resolveImplementation: defaultResolveImplementation(resolveOptions),
  }
  try {
    const g = await dependencyTree(gtx, [entryPoint], resolveOptions)
    console.log("graph ", entryPoint, "is");
    g.print_errors()
    console.log(g.files_with_requires_to_string());

    const lines: string[] = []
    for (const file of g.files()) {
      lines.push(`file: ${file.path}`)

      for (const v of [1, 2, 3, 4, 5, 6]) {
        lines.push(`\n kind ${v}\n`)
        const transpiled = (await ss.transpiled({moduleKind: v, cacheIdOfPath: await ss.hash(file.path)})).item
        // const transpiled = ts.transpileModule(fs.readFileSync(file.path, "utf8"), { compilerOptions: { module: v } })
        lines.push(transpiled.outputText)
        lines.push("\n===\n")
      }

      lines.push(JSON.stringify(file.resolvedFiles))
      lines.push("\n===\n")
      lines.push("\n\n")
    }
    process.stdout.write(lines.join("\n"))

  } catch (error) {
    console.log("ERRor", exception_to_str(error), error)
  }
}

// tslint:disable-next-line: no-floating-promises
graph_of(config.entryPoints[0])

process.on("unhandledRejection", (error) => {
  console.log("unhandledRejection", error);
  // @ts-ignore
  console.dir(error.trace)
});
