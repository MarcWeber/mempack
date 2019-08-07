import * as Bluebird from "bluebird"
import chalk from "chalk";
import express, { Router } from "express";
import * as fs from "fs";
import { fileStat } from "fuse-box/utils/utils";
import JSON5 from "json5";
import path from "path";
import { js_setup_service_worker } from "ttslib/serviceworker";
import { async_singleton } from "ttslib/U";
import ts, { createTextChangeRange, getParsedCommandLineOfConfigFile } from "typescript";
import * as _ from "underscore"
import { promisify } from "util";
import { defaultResolveImplementation, dependencies, Dependencies, DependencyTree, filesAndHashesOfDependencyTree, ResolveOptions, resolveOptions, Target } from "./dependencies";
import { p } from "./dummy";
import { fakerequire } from "./fakerequire";
import { GlobalState } from "./GlobalState";
import { createHMRServer } from "./hmrServer";
import { log } from "./log";
import { NormalizedDependencyResult } from "./normalizeddependencies";
import { node_hot_reload, notify_sync_process, path_walk_till } from "./Util";
import * as Watcher from "./WatcherSane"

const exists = promisify(fs.exists)
const stat   = promisify(fs.stat)

// easy to configure set of modules / entry points whith some yet to be defined references
export interface ContextUser {
  path?: string, // all paths will be taken relative to this one
  node_modules?: string[],
  entryPoints: string[],
  target: Target,
  // path to tsconfig.json file relative to path?
  // or dictionary
  tsconfig?: string | {
    path?: string
    config: ts.CompilerOptions,
  },
}

// Same as ContextUser but with all optional fields resolved
export interface ContextUserResolved {
  path: string,
  node_modules: string[],
  entryPoints: string[],
  target: Target,
  tsconfig: {
    path: string
    config: ts.CompilerOptions,
  },
}

// function turning ContextUser -> ContextResolved
export const resolveContext: (f: () => ContextUser) => () => ContextUserResolved = (f) => () => {
  const cwd = process.cwd()
  const make_absolute = (p: string) => path.resolve(cwd, p)

  const c: ContextUser = f()

  const p: string = c.path ? make_absolute(c.path) : process.cwd()
  const tsconfig = c.tsconfig
    ? (
      (typeof c.tsconfig === "string")
      ? {
          path: make_absolute(path.dirname(c.tsconfig)),
          config: JSON5.parse(fs.readFileSync(c.tsconfig, "utf8")),
      }
      : {
        path: c.tsconfig && c.tsconfig.path ? make_absolute(c.tsconfig.path) : p,
        config: c.tsconfig ? c.tsconfig.config : {},
      }
    )
    : // default
    {
      path: p,
      config: { },
    }

  const r = {
    target: c.target,
    path: p,
    node_modules: c.node_modules ? c.node_modules.map((make_absolute)) : [],
    entryPoints:  c.entryPoints.map(make_absolute),
    tsconfig,
  }
  console.log("r ", r )
  return r;
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

export type ChangedFiles = (whiteList: string[]) => Promise<string[]>
// DependencyTree
type WithErrors<T> = T & { errors: string[], warnings: string[] }
export type DependencyTreeChanged<T> = (trees: {new_: WithErrors<T>, last: WithErrors<T>, config: ContextUserResolved}) => void

export const watched_context = (o: {
      globalState: GlobalState,
      config: () => ContextUserResolved,
      update?: DependencyTreeChanged<Dependencies>,
      delay_ms?: number,
      target: Target,
    }) => {

  const delay_ms = o.delay_ms ? o.delay_ms : 0;

  // const m = Cache.initCache2(o.globalState.cache, {watcher})

  const new_run = () => {

      const config = o.config()

      // const resolveOptions = {
      //   node_modules: config.node_modules,
      //   target: o.target,
      //   tsconfig: config.tsconfig,
      // }

      // const gtx: CTX = {
      //   // gS: o.globalState,
      //   ss: o.globalState.snaphshottedCache(),
      //   event_file_found: [],
      //   log: console.log.bind(console),
      //   throwError: false, // TODO: should be early abort
      //   // isFile: (path:string) => Promise<boolean>
      //   // log: (msg: string) => {},
      //   // throwError: false,
      //   resolveImplementation: defaultResolveImplementation(resolveOptions),
      // }
      const errors: string[] = []
      const warnings: string[] = []

      const ro = resolveOptions({
        gS: o.globalState,
        node_modules: config.node_modules,
        target: config.target,
        tsconfig: config.tsconfig,
        error: (e) => errors.push(e),
        warning: (e) => warnings.push(e),
      })
      const resolveImplementation = defaultResolveImplementation(ro)
      return {
        resolveDependencies: dependencies(ro, resolveImplementation).resolveDependencies,
        errors,
        warnings,
        config,
      }
  }
  let last_context = new_run()
  let timer: number|undefined
  let new_: ReturnType<typeof new_run>

  if (o.globalState.watcher) o.globalState.watcher.watchers.push((...x: any[]) => {
    log("FILE CHANGE")
    // TODO: invalidate resources in globalCache
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      log("FILE and timeout")

      // if (promise_new_context)
        // promise_new_context.cancel()
      new_ = new_run()
      if (o.update) o.update({ last: last_context, new_, config: new_.config })
      last_context = new_

    }, delay_ms)
  })
  return last_context
}

// SERVER SIDE HOT RELOADING CODE

export const node_hmr = (globalState: GlobalState, config: () => ContextUserResolved) => {
  // well this seems to work good enough, but your code must be written in special way, eg
  // import * as hmr from 'hmr'
  //    app.get('/', (a,b) => hmr.fun(a,b))
  // thus the code which gets executed must be called from exports

  // maybe a better implementation is using globalState -> watcher like implementation on ts-node (investgate in the future)
  // if this works good enough I'll be fine for now

  // tslint:disable-next-line: no-floating-promises
  const r = watched_context({
    globalState,
    target: "node",
    update: async (new_last) => {
      try {
        const ePs = new_last.config.entryPoints

        await new_last.last.resolveDependencies(ePs)
        await new_last.new_.resolveDependencies(ePs)
        await new_last.last.resolveDependencies(ePs)
        await new_last.new_.resolveDependencies(ePs)

        const [o, n] = await Promise.all([new_last.last.resolveDependencies(ePs), new_last.new_.resolveDependencies(ePs)])
        const oldfiles = filesAndHashesOfDependencyTree(ePs, o)
        const newfiles = filesAndHashesOfDependencyTree(ePs, n)
        const loaded_files = Object.keys(require.cache)

        const files_to_reload: string[] = []
        const files_to_reload_sorted: string[] = []

        for (const l of loaded_files) {
          if (oldfiles[l] && newfiles[l] && oldfiles[l] !== newfiles[l])
            files_to_reload.push(l)
        }

        console.log("files_to_reload", files_to_reload)
        console.log("files_to_reload_sorted", files_to_reload_sorted)

        // now hot reload leafs in tree first, becauset here are cycles, keep notes
        const seen: { [key: string]: 1 } = {}
        const walk = (path: string) => {
          if (path in seen ) return;
          seen[path] = 1
          require.cache[path].children.map((x: any) => {
            if (files_to_reload.indexOf(x.id) >= 0) {
              files_to_reload_sorted.push(x.id)
              seen[x.id] = 1
            }
          } )
          files_to_reload_sorted.push(path)
        }
        files_to_reload.map((x) => walk(x))
        notify_sync_process(`hot releading ${files_to_reload_sorted.join(", ")}`, () => node_hot_reload(files_to_reload_sorted))
      } catch (e) {
        console.log("error while calculating file changes: ", e)
      }
    },
    config,
  })
  console.log("r2", r)
  // walk the dependency tree to start watching for changes
  // tslint:disable-next-line: no-floating-promises
  r.resolveDependencies(r.config.entryPoints)
}

export const node_hmr_default = (globalState: GlobalState, opts: { basedir?: string }) => {
  const basedir = opts.basedir || path_walk_till({pathsExists: ["tsconfig.json"]})
  node_hmr(globalState,
    resolveContext(() => {
      return {
        // path ?: string, // all paths will be taken relative to this one
        target: "node",
        node_modules: [`${basedir}/node_modules`],
        entryPoints: [process.argv[1]],
        tsconfig: `${basedir}/tsconfig.json`,
        // path?: string
        // config: ts.CompilerOptions,
      };
    }),
  )
}

// // CLIENT SIDE IMPLEMENTATION
// // multiple implementations are provided
// // might change in the future
// // trying to proivde common interface so that all you have to do is add some 'HTML' to your html page
//
// type ClientCodeConfig =
// // watch = true = rebundles if files changes - you eventually don't want to restart server.
// {
//   config: () => ContextUserResolved,
//   dependencygraph_path?: string,
//   node_hmr?: boolean,
// }
// &
// (
// { // [x] works
//   // loadd modules by <module > tag ..?
//   // https://jakearchibald.com/2017/es-modules-in-browsers/
//   // TODO: mapping file
//   type: "meta_modules",
//   module_path?: string, // eg /modules
//   // watch: boolean,
//   fallback?: (entry: string) => string,
// }
// |
// {
//   // [ ] to be done
//   // using own fake_require code sending modules at once ..
//   // first downloads a bundle with all files (or should they be fetched in a sync way as needed ?)
//   // room for impromenent with partial bundeling etc...
//   // then setups ws server so that changes can be pushed (hot reloading)
//   type: "systemjs_fake_require",
//   urlprefix?: string, // eg /modules
//   hmr_port?: number, // eg 8080
//   prepackaged_modules: string[] | "all", // pass modules which should be sent with initial file for faster loading. Use "all" to pass all
//   module_path?: string, // if set allows lazy loading of modules in a strict way (which is deprecated soon in browsers - but might get the job done for now)
// }
// |
// {
//   // [ ] to be designed
//   type: "serviceworker_systemjs_fake_require",
// }
// // |
// // { // production?
// //   type: "static_bundles", // ?
// //   watch: boolean, // true = rebundles if files changes - you eventually don't want to restart server.
// //                   // however instead you can use hmr or serviceworker options
// //   bundlepath?: (entry:string) => string
// // } | { // development hot module reloading
// //   type: "hmr",
// //   serviceworkerpath?: string
// // } | { // same as hmr, but use serviceworker code to update and for offline suppoprt
// //   type: "serviceworker",
// //   serviceworkerpath?: string
// // }
// )
// // modules individual imports
//
// // embed this to have client code run in the browser as 'client' code.
// // select type to switch between dist/ hmr or serviceworker setups
// export const clientCode: (gS: GlobalState, config: ClientCodeConfig) => {
//   head_html: (entryPoints: string[]) => Promise<string>,
//   serve_via_express: (e: express.Express, opts: {
//     debug_module_graph_path?: string, // eg "/module-graph"
//     debug_transpiled_modules?: string, // eg "/transpiled-modules"
//   }) => void,
// } =  (gS, config) => {
//
//   if (config.node_hmr) {
//     node_hmr_default(gS, {})
//   }
//
// // const c = config.config()
// // const resolveOptions = {
// //     node_modules: c.node_modules,
// //     target: "browser" as "browser",
// //     tsconfig: c.tsconfig,
// //   }
//
// // const gtx: GCTX = {
// //     gS,
// //     event_file_found: [],
// //     log: console.log.bind(console),
// //     throwError: false, // TODO: should be early abort
// //     // isFile: (path:string) => Promise<boolean>
// //     // log: (msg: string) => {},
// //     // throwError: false,
// //     resolveImplementation: defaultResolveImplementation(resolveOptions),
// //   }
//
// // const graph = dependencyTree(gtx, c.entryPoints, resolveOptions)
//
//   const wc = (newContext?: DependencyTreeChanged) => watched_context({
//     globalState: gS,
//     target: "browser",
//     config: config.config,
//     newContext,
//     // : async (o) => {
//     //   graph = Bluebird.Promise.resolve(o.new_)
//     // },
//   })
//
//   const server_debug = (router: Router,
//                         state: {graph: Promise<Context>},
//                         o: {
//                           debug_module_graph_path?: string,
//                           debug_transpiled_modules?: string,
//                         }) => {
//         if (o.debug_module_graph_path)
//           router.get(`${o.debug_module_graph_path}`, async (request, response) => {
//             const g = await state.graph
//             response.type("txt")
//             // response.send("module graph\n")
//             response.end(g.files_with_requires_to_string())
//           })
//
//         if (o.debug_transpiled_modules)
//           router.get(`${o.debug_transpiled_modules}`, async (request, response) => {
//             const g = await state.graph
//             response.type("txt")
//             const lines = []
//             const files: File[] = []
//             for (const file of g.files()) {
//               lines.push(`file: ${file.path}`)
//               const transpiled = (await g.ctx.ss.transpiled({ moduleKind: ts.ModuleKind.ESNext, cacheIdOfPath: await file.cacheId })).item
//               lines.push(transpiled.outputText)
//               lines.push("\n===\n")
//               lines.push(transpiled.sourceMapText)
//               lines.push("\n===\n")
//               lines.push(transpiled.diagnostics)
//               lines.push("\n===\n")
//             }
//             response.end(g.files_with_requires_to_string() + "\n" + lines.join("\n"))
//           })
//   }
//
//   if (config.type === "meta_modules") {
//     // very simple implementation, only updating itself on reload
//
//     const state = { graph: wc((o) => { state.graph = Promise.resolve(o.new_) }) }
//     const url_prefix = config.module_path || "/modules"
//
//     const modulesAndContents = async (graph: Context) => {
//       const files: { [key: string]: () => Promise<string> } = {}
//       for (const file of graph.files()) {
//
//         files[file.path] = async () =>
//         graph.ctx.ss.transpiled({ moduleKind: ts.ModuleKind.ESNext, cacheIdOfPath: await file.cacheId })
//             .then((x) => x.item.outputText)
//             .then((x) => {
//               for (const [k, v] of Object.entries(file.resolvedFiles)) {
//                 // const from = `require("${JSON.parse(k).statement}")`
//                 // const to = `require("${url_prefix}/${v.path}")`
//                 const from = `from "${JSON.parse(k).statement}"`
//                 const to = `from "${url_prefix}/${v.path}"`
//                 console.log("replacing", from, to)
//                 x = x.replace(from, to)
//               }
//               return x;
//             })
//       }
//       return {
//         files,
//         entryTag: (entry: string) => `<script type="module" src="${entry}"></script>`,
//       }
//     }
//
//     const macp = state.graph.then(modulesAndContents)
//
//     return {
//       head_html: async (entryPoints: string[]) => {
//         const html = []
//         const mac = await macp
//         for (const [k, v] of Object.entries(mac.files)) {
//           // doesn't seem to be required ..
//           html.push(`<script type="module" src="${url_prefix}/${k}"></script>`)
//         }
//         // <script async type="..">
//         let n = 0
//         entryPoints.forEach((x) => {
//           n += 1
//           html.push(`
//         <script type="module">
//           import * as dummy${n} from '${url_prefix}/${x}';
//         </script>
//         `)
//         },
//         )
//         html.push("")
//         return html.join("\n");
//       },
//       serve_via_express: (e: express.Express, opts = {}) => {
//         const router = express.Router()
//         server_debug(router, state, optsThe account is assoc
//         router.use((req, res, next) => {The account is assoc
//           if (!req.originalUrl.startsWith(url_prefix)) {
//             next();
//           }
//           // tslint:disable-next-line: no-floating-promises
//           macp.then(async (mac) => {
//             const path = req.originalUrl.substr(url_prefix.length + 1)
//             console.log(`serving path ${path}`)
//             if (path in mac.files) {
//               // TODO etag like hash tagging
//               res.type("text/javascript")
//               res.send(await mac.files[path]())
//               return
//             }
//             next()
//           })
//         })
//         e.use(router)
//         console.log("mempack router setup")
//       },
//     }
//   }
//
//   if (config.type === "systemjs_fake_require") {
//     // very simple implementation, only updating itself on reload
//
//     const ws = createHMRServer({port: config.hmr_port})
//
//     const state = {
//       changed_files: async (x: string[]): Promise<string[]> => { throw new Error("unexpected") },
//       graph: wc((o) => {
//         state.graph = Promise.resolve(o.new_)
//         // now push notification that client can pull updates
//         state.changed_files = o.changed_files
//       }),
//     }
//     const url_prefix = config.urlprefix || "/modules"
//
//     // const modulesAndContents = async (graph: Context) => {
//     //   const files: { [key: string]: () => Promise<string> } = {}
//     //   for (const file of graph.files()) {
//
//     //     files[file.path] = () =>
//     //       gS.cache.get("transpiled")({ moduleKind: ts.ModuleKind.ESNext, path: file.path }).p
//     //         .then((x) => x.outputText)
//     //         .then((x) => {
//     //           for (const [k, v] of Object.entries(file.resolvedFiles)) {
//     //             // const from = `require("${JSON.parse(k).statement}")`
//     //             // const to = `require("${url_prefix}/${v.path}")`
//     //             const from = `from "${JSON.parse(k).statement}"`
//     //             const to = `from "${url_prefix}/${v.path}"`
//     //             console.log("replacing", from, to)
//     //             x = x.replace(from, to)
//     //           }
//     //           return x;
//     //         })
//     //   }
//     //   return {
//     //     files,
//     //     entryTag: (entry: string) => `<script type="module" src="${entry}"></script>`,
//     //   }
//     // }
//
//     // const macp = state.graph.then(modulesAndContents)
//
//     return {
//       head_html: async (entryPoints: string[]) => {
//         const html = []
//         html.push(`<script>
//         ${fakerequire}
//         System.load = (path) => {The account is assoc
//           var xhr = new XMLHttpReThe account is assoc
//           xhr.open("GET", "${url_The account is assoc
//           xhr.onload = function (The account is assoc
//             if (xhr.readyState ==The account is assoc
//               if (xhr.status === The account is assoc
//                 console.log(xhr.rThe account is assoc
//               } else {
//                 console.error(xhrThe account is assoc
//               }
//             }
//           };
//           xhr.onerror = function (e) {
//             console.error(xhr.statusText);
//           };
//           xhr.send(null);
//         }
//         </script>`)
//         // <script async type="..">
//         let n = 0
//         entryPoints.forEach((x) => {
//           n += 1
//           html.push(`
//         <script type="module">
//           import * as dummy${n} from '${url_prefix}/${x}';
//         </script>
//         `)
//         },
//         )
//         html.push("")
//         return html.join("\n");
//       },
//       serve_via_express: (e: express.Express, opts = {}) => {
//         const router = express.Router()
//         server_debug(router, state, opts)
//         router.use((req, res, next) => {
//           if (!req.originalUrl.startsWith(url_prefix)) {
//             next();
//           }
//           // tslint:disable-next-line: no-floating-promises
//           macp.then(async (mac) => {
//             const path = req.originalUrl.substr(url_prefix.length + 1)
//             console.log(`serving path ${path}`)
//             if (path in mac.files) {
//               // TODO etag like hash tagging
//               res.type("text/javascript")
//               res.send(await mac.files[path]())
//               return
//             }
//             next()
//           })
//         })
//         e.use(router)
//         console.log("mempack router setup")
//       },
//     }
//   }
//
//   // if (config.type === "static_bundles"){
//   //   const jsfiles = (entryPoints: string[]) => { return [{ path: "" }] }
//   //   return {
//   //     jsfiles,
//   //     jsfiles_as_html: jsfiles_as_html(jsfiles),
//   //     serve_via_express: (e: express.Express) => {
//   //     }
//   //   }
//   // }
//
//   // if (config.type === "hmr"){
//   //   const jsfiles = (entryPoints: string[]) => { return [{ path: "" }] }
//   //   return {
//   //     jsfiles,
//   //     jsfiles_as_html: jsfiles_as_html(jsfiles),
//   //     serve_via_express: (e: express.Express) => { }The account is assoc
//   //   }
//   // }
//
//   // if (config.type === "serviceworker"){
//   //   const jsfiles = (entryPoints: string[]) => { retThe account is assoc}] }
//   //   return {
//   //     jsfiles,
//   //     jsfiles_as_html: jsfiles_as_html(jsfiles),
//   //     serve_via_express: (e: express.Express) => {
//   //     }
//   //   }
//   // }
//   throw new Error("unexpected");
// }
//
// // export const hmrViaServiceWorker = (config_: {port: number, serviceworker_path?:string}, globalState: GlobalState<{}>, app:express.Express, ctx: () => ContextResolved) => {
// //   return {
// //     js: (entrypoint:string) => {
// //     }
// //   }
// // }
//
// // export const hmr = (config: {port?: number}, globalState: GlobalState<{}>, app: express.Express, ctx: () => ContextUserResolved) => {
//
// //   const x = createHMRServer({
// //     port : config.port,
// //   })
//
// //   const ctxState = {
// //     m,
// //     watcher,
// //     fileExistsSync: (path: string) => {
// //       watcher.watch(path)
// //       return fs.existsSync(path)
// //     },
// //     readFileSync: (path: string) => {
// //       watcher.watch(path)
// //       return fs.existsSync(path)
// //     },
// //   }
//
// //   return {
// //     js: (entrypoint: string) => {
// //     },
// //   }
// // }
//
// // export const contextInstance = <I>(globalState: GlobalState<I>, ctx: ContextUserResolved, watch: boolean, emitHandlers: EmitHandler) => {
// //   const watcher = globalState.watcher.new_watcher()
// //   const m: any = {}
// //   // using global cache object
// //   Cache.initCache2(globalState.cache, m)
// //   // but overwriting file_as_string so that this watcher is populated automatically
// //   const fas = Cache.file_as_string_a_h(m)
// //   m.file_as_string_a_h = (path: string) => {
// //     watcher.watch(path)
// //     return fas(path)
// //   }
// //   const ft = Cache.file_type_a_h(m)
// //   m.file_type_a_h     = async (path: string) => {
// //     watcher.watch(path)
// //     return ft(path)
// //   }
// //   const ctxState = {
// //     m,
// //     watcher,
// //   }
// // }
//
