import console = require("console");
import express from "express";
import * as fs from "fs";
import { GlobalWatcher } from "fuse-box/Watcher";
import JSON5 from "json5";
import path from "path";
import { async_singleton } from "ttslib/U";
import ts, { createTextChangeRange } from "typescript";
import { promisify } from "util";
import * as Cache from "./Cache";
import { Context, defaultResolveImplementation, dependencyTree, File, GCTX } from "./dependencies";
import { createHMRServer } from "./hmrServer";

const exists = promisify(fs.exists)
const stat   = promisify(fs.stat)

export interface ContextUser {
  path?: string, // all paths will be taken relative to this one
  node_modules?: string[],
  entryPoints: string[],
  // path to tsconfig.json file relative to path?
  // or dictionary
  tsconfig?: string | {
    path?: string
    config: ts.CompilerOptions,
  },
}

// A function allows to follow file changes ..
export interface ContextResolved {
  path: string,
  node_modules: string[],
  entryPoints: string[],
  tsconfig: {
    path: string
    config: ts.CompilerOptions,
  },
}

export const resolveContext: (f: () => ContextUser) => () => ContextResolved = (f) => () => {
  const c: ContextUser = f()
  const p: string = c.path ? c.path : process.cwd()
  const tsconfig = c.tsconfig
    ? (
      (typeof c.tsconfig === "string")
      ? {
          path: path.dirname(c.tsconfig),
          config: JSON5.parse(fs.readFileSync(c.tsconfig, "utf8")),
      }
      : {
        path: c.tsconfig && c.tsconfig.path ? c.tsconfig.path : p,
        config: c.tsconfig ? c.tsconfig.config : {},
      }
    )
    : // default
    {
      path: p,
      config: { },
    }

  return {
    path: p,
    node_modules: c.node_modules ? c.node_modules : [],
    entryPoints:  c.entryPoints,
    tsconfig,
  }
}

type EmitEvent = {type: "emitting" | "emitting_end" } | {type: "file", path: string, content: string}
type EmitHandler = (event: EmitEvent) => void

/* sample dist like emit implemenation
const emitHandlerDist = (opts: {dist:string, rimraf: boolean}) =>
  // stupid implementation:
  (event: EmitEvent) => {
    if (event.type == "emitting"){
      if (opts.rimraf) U.rimraf(dist, {});
    }
    if (event.type == "file"){
      fs.writeFileSync(path.join("dist", event.path), event.content, 'utf8')
    }
  }
*/

interface GlobalState<C> {
  cache: Cache.Cache, // newCache result
  watcher: GlobalWatcher,
  // newRun: (opts:{
  //   changed?: () => void
  // })
}

type ClientCodeConfig =
// watch = true = rebundles if files changes - you eventually don't want to restart server.
{
  config: () => ContextResolved,
  dependencygraph_path?: string,
}
&
(
{ // loadd modules by <module > tag ..?
  // https://jakearchibald.com/2017/es-modules-in-browsers/
  type: "meta_modules",
  urlprefix?: string, // eg /modules
  // watch: boolean,
  fallback?: (entry: string) => string,
}
// |
// { // production?
//   type: "static_bundles", // ?
//   watch: boolean, // true = rebundles if files changes - you eventually don't want to restart server.
//                   // however instead you can use hmr or serviceworker options
//   bundlepath?: (entry:string) => string
// } | { // development hot module reloading
//   type: "hmr",
//   serviceworkerpath?: string
// } | { // same as hmr, but use serviceworker code to update and for offline suppoprt
//   type: "serviceworker",
//   serviceworkerpath?: string
// }
)
// modules individual imports
// https://jakearchibald.com/2017/es-modules-in-browsers/

// embed this to have client code run in the browser as 'client' code.
// select type to switch between dist/ hmr or serviceworker setups
export const clientCode: (globalState: GlobalState<any>, config: ClientCodeConfig) => {
  jsfiles_as_html: (entryPoints: string[]) => Promise<string>,
  serve_via_express: (e: express.Express, opts: {
    debug_module_graph_path?: string, // eg "/module-graph"
    debug_transpiled_modules?: string, // eg "/transpiled-modules"
  }) => void,
} =  (globalState, config) => {

  const m = Cache.initCache2(globalState.cache, {})
  const c = config.config()
  const resolveOptions = {
    node_modules: c.node_modules,
    target: "browser" as "browser",
    tsconfig: c.tsconfig,
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

  const graph = dependencyTree(gtx, c.entryPoints, resolveOptions)

  if (config.type === "meta_modules") {
    const url_prefix = config.urlprefix || "/modules"

    const modulesAndContents = async (graph: Context) => {
      const files: {[key: string]: () => Promise<string>} = {}
      for (const file of graph.files()) {
        files[file.path] = async_singleton(() =>
        m.file_transpiled_a_h(ts.ModuleKind.ESNext, file.path).value
        .then((x) => x.value.outputText)
        .then((x) => {
          for (const [k, v] of Object.entries(file.resolvedFiles)) {
            // const from = `require("${JSON.parse(k).statement}")`
            // const to = `require("${url_prefix}/${v.path}")`
            const from = `from "${JSON.parse(k).statement}"`
            const to = `from "${url_prefix}/${v.path}"`
            console.log("replacing", from, to)
            x = x.replace(from, to)
          }
          return x;
        }))
      }
      return {
        files,
        entryTag: (entry: string) => `<script type="module" src="${entry}"></script>`,
      }
    }

    const macp = graph.then(modulesAndContents)

    return {
      jsfiles_as_html: async (entryPoints: string[]) => {
        const html = []
        const mac = await macp
        for (const [k, v] of Object.entries(mac.files)) {
          // doesn't seem to be required ..
          html.push(`<script type="module" src="${url_prefix}/${k}"></script>`)
        }
        // <script async type="..">
        let n = 0
        entryPoints.forEach((x) => {
          n += 1
          html.push(`
        <script type="module">
          import * as dummy${n} from '${url_prefix}/${x}';
        </script>
        `)
        },
        )
        html.push("")
        return html.join("\n");
      },
      serve_via_express: (e: express.Express, opts = {}) => {
        const router = express.Router()

        if (opts.debug_module_graph_path)
          router.get(`${opts.debug_module_graph_path}`, async (request, response) => {
            const g = await graph
            response.type("txt")
            // response.send("module graph\n")
            response.end(g.files_with_requires_to_string())
          })

        if (opts.debug_transpiled_modules)
          router.get(`${opts.debug_transpiled_modules}`, async (request, response) => {
            const g = await graph
            response.type("txt")
            const lines = []
            const files: File[] = []
            for (const file of g.files()) {
              lines.push(`file: ${file.path}`)
              const transpiled = await m.file_transpiled_a_h(ts.ModuleKind.ESNext, file.path).value
              lines.push(transpiled.value.outputText)
              lines.push("\n===\n")
              lines.push(transpiled.value.sourceMapText)
              lines.push("\n===\n")
              lines.push(transpiled.value.diagnostics)
              lines.push("\n===\n")
            }
            response.end(g.files_with_requires_to_string() + "\n" + lines.join("\n"))
          })

        router.use((req, res, next) => {

          if (!req.originalUrl.startsWith(url_prefix)) {
            next();
          }
          // tslint:disable-next-line: no-floating-promises
          macp.then(async (mac) => {
            const path = req.originalUrl.substr(url_prefix.length + 1)
            console.log(`serving path ${path}`)
            if (path in mac.files) {
              // TODO etag like hash tagging
              res.type("text/javascript")
              res.send(await mac.files[path]())
              return
            }
            next()
          })
        })
        e.use(router)
        console.log("mempack router setup")
      },
    }
  }

  // if (config.type === "static_bundles"){
  //   const jsfiles = (entryPoints: string[]) => { return [{ path: "" }] }
  //   return {
  //     jsfiles,
  //     jsfiles_as_html: jsfiles_as_html(jsfiles),
  //     serve_via_express: (e: express.Express) => {
  //     }
  //   }
  // }

  // if (config.type === "hmr"){
  //   const jsfiles = (entryPoints: string[]) => { return [{ path: "" }] }
  //   return {
  //     jsfiles,
  //     jsfiles_as_html: jsfiles_as_html(jsfiles),
  //     serve_via_express: (e: express.Express) => { }
  //   }
  // }

  // if (config.type === "serviceworker"){
  //   const jsfiles = (entryPoints: string[]) => { return [{ path: "" }] }
  //   return {
  //     jsfiles,
  //     jsfiles_as_html: jsfiles_as_html(jsfiles),
  //     serve_via_express: (e: express.Express) => {
  //     }
  //   }
  // }
  throw new Error("unexpected");
}

export const newGlobalState: <I>() => GlobalState<{}> = () => {
  return {
    cache: Cache.new_cache(),
    watcher: new GlobalWatcher(),
  }
}

// export const hmrViaServiceWorker = (config_: {port: number, serviceworker_path?:string}, globalState: GlobalState<{}>, app:express.Express, ctx: () => ContextResolved) => {
//   return {
//     js: (entrypoint:string) => {
//     }
//   }
// }

export const hmr = (config: {port?: number}, globalState: GlobalState<{}>, app: express.Express, ctx: () => ContextResolved) => {
  const watcher = globalState.watcher.new_watcher()
  const m: any = {}

  // using global cache object
  Cache.initCache(globalState.cache, m)
  // but overwriting file_as_string so that this watcher is populated automatically

  const fas = Cache.file_as_string_a_h(m)
  m.file_as_string_a_h = async (path: string) => {
    watcher.watch(path)
    return fas(path)
  }
  m.file_analysed_a_h   = Cache.file_analysed_a_h(m)
  m.file_transpiled_a_h = Cache.file_transpiled_a_h(m)
  m.file_transpiled_a_h = Cache.file_as_json_a_h(m)

  const x = createHMRServer({
    port : config.port,
  })

  const ctxState = {
    m,
    watcher,
    fileExistsSync: (path: string) => {
      watcher.watch(path)
      return fs.existsSync(path)
    },
    readFileSync: (path: string) => {
      watcher.watch(path)
      return fs.existsSync(path)
    },
  }

  return {
    js: (entrypoint: string) => {
    },
  }
}

export const contextInstance = <I>(globalState: GlobalState<I>, ctx: ContextResolved, watch: boolean, emitHandlers: EmitHandler) => {
  const watcher = globalState.watcher.new_watcher()
  const m: any = {}
  // using global cache object
  Cache.initCache2(globalState.cache, m)
  // but overwriting file_as_string so that this watcher is populated automatically
  const fas = Cache.file_as_string_a_h(m)
  m.file_as_string_a_h = (path: string) => {
    watcher.watch(path)
    return fas(path)
  }
  const ft = Cache.file_type_a_h(m)
  m.file_type_a_h     = async (path: string) => {
    watcher.watch(path)
    return ft(path)
  }
  const ctxState = {
    m,
    watcher,
  }
}
