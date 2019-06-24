// import * as path from 'path';
// import { createContext } from 'fuse-box/src/core/Context';
// import { bundleDev } from 'fuse-box/src/main/bundle_dev';
// import { props } from 'bluebird';
// import { Bundle } from 'fuse-box/src/bundle/Bundle';
// import { pluginStart } from 'fuse-box/src/plugins/core/plugin_start';
// import { pluginTypescript } from 'fuse-box/src/plugins/core/plugin_typescript';
import * as fs from "fs";
// import { dependencyTree, defaultResolveImplementation, ResolveOptions } from 'fuse-box/src/mw/dependencies';
import { exception_to_str } from "ttslib/exception";
import * as ts from "typescript"
import * as Cache from "../../src/Cache"
import { defaultResolveImplementation, dependencyTree, GCTX } from "../../src/dependencies";
import * as Mempack from "../../src/Mempack"

const globalState = Mempack.newGlobalState()

const graph_of = async (entryPoint: string) => {
  const clientConfig: Mempack.ContextUser = {
    entryPoints : ["client.ts"],
  }
  const resolvedContext = Mempack.resolveContext(() => clientConfig)()
  const m = Cache.initCache2(globalState.cache, {})
  const resolveOptions = {
    node_modules: resolvedContext.node_modules,
    target: "browser" as "browser",
    tsconfig: resolvedContext.tsconfig,
  }

  const gtx: GCTX = Object.assign(m, {
    event_file_found: [],
    log: console.log.bind(console),
    throwError: false, // TODO: should be early abort
    // isFile: (path:string) => Promise<boolean>
    // log: (msg: string) => {},
    // throwError: false,
    resolveImplementation: defaultResolveImplementation(resolveOptions),
  })
  try {
    const g = await dependencyTree(gtx, [entryPoint], resolveOptions)
    console.log("graph ", entryPoint, "is");
    console.log(g.files_with_requires_to_string());

    const lines = []
    for (const file of g.files()) {
      lines.push(`file: ${file.path}`)

      for (const v of [1, 2, 3, 4, 5, 6]) {
        lines.push(`\n kind ${v}\n`)
        const transpiled = (await m.file_transpiled_a_h(v, file.path).value).value
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
graph_of("client.ts")

process.on("unhandledRejection", (error) => {
  console.log("unhandledRejection", exception_to_str(error));
});
