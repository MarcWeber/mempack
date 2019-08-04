import * as path from "path"
import { AbsolutePath } from "./dependencies";
import { FileTypeReturnType, FSCache, newFsCache as newFsCache } from "./FSCache";
import { CacheId, CacheRoots, file_analyzed, file_as_json, file_transpiled, HashedCache, newGlobalHashedCache } from "./HashedCache";
import { log } from "./log";
import { throw_ } from "./Util";
import * as Watcher from "./WatcherSane"

export interface TypeCF {
  file_analyzed: typeof file_analyzed,
  file_transpiled: typeof file_transpiled,
  file_as_json: typeof file_as_json,
}

export type GlobalStateCacheRoots = CacheRoots<TypeCF>

export type NodeModulesContainingFile = (p: { path: string, node_modules: AbsolutePath[] }) => Promise<AbsolutePath[]>

export type Snapshot = GlobalStateCacheRoots & {
  hash: (path: string) => Promise<CacheId>,
  file: ReturnType<FSCache["file_hash"]>,
  filetype: FSCache["filetype"],
  transpiled: ReturnType<typeof file_transpiled > ,
  json: ReturnType < typeof file_as_json > ,
  jsonFromPath: (path: string) => Promise<any | undefined>,
  analyzed: ReturnType < typeof file_analyzed > ,
  node_modules_containing_file: NodeModulesContainingFile,
}

export interface GlobalState {
  watcher?: Watcher.Watcher,
  fscache: FSCache,
  snaphshottedCache: () => Snapshot
  // cache: ReturnType<typeof Cache.new_cache_with_implemenation>, // newCache result
  // watcher?: Watcher.Watcher,
  // newRun: (opts:{
  //   changed?: () => void
  // })
  release: () => void, // you can wait for gc .. but this is faster
}

let globalStates = 0;

export const newGlobalState = (o: {watch?: boolean}): GlobalState => {
  log(`GlobalState: newGlobalState`)

  globalStates += 1
  if (globalStates > 1) log(`GlobalState: WARNING ${globalStates} global states created, should be 1 to share caching`)
  if (globalStates > 1) throw new Error("multiple global states") // drop this later - for testing

  const hashedCache =  newGlobalHashedCache({
    file_analyzed,
    file_transpiled,
    file_as_json,
  })

  const watcher = o.watch ? new Watcher.Watcher() : undefined
  log(`FSCache watching ${watcher ? "YES" : "NO"}`)
  const fscache: FSCache =
    newFsCache(
      watcher === undefined ? undefined
      : {
        watch: watcher.watch.bind(watcher),
        on_change: ((f) => watcher.watchers.push((a, b) =>  {
          log(`FSCache file change dedected ${a}`)
          f(a)
        })),
      },
    )

  const filetype_cache: {[key: string]: FileTypeReturnType}  = {}
  const filetype = async (path: string) => {
    if (!(path in filetype_cache))
      filetype_cache[path] = await fscache.filetype(path)
    return filetype_cache[path]
 }

  const node_modules_containing_file: NodeModulesContainingFile = async (p) => {
    // const node_modules: string[] = p.repo_path ? [p.repo_path] : opts.resolveOptions.node_modules
    const c = p.path.replace(/[/\/].*/, "")
    const r: string[] = []
    for (const nm of p.node_modules) {
      if (["file", "directory"].includes(await filetype(path.join(nm, c))))
        r.push(nm)
    }
    return r
  }

  return {
    release: () => {
      if (watcher) watcher.close()
    },
    watcher,
    fscache,
    snaphshottedCache: () => {
      const hc = hashedCache.cacheRootsObject()
      const file = fscache.file_hash(hc)
      const json = file_as_json(hc)
      const hash = (path: string) => file(path).then((x) => !x ? throw_(`file ${path} not readable`) :  x.cacheId)
      const analyzed = file_analyzed(hc)
      // hc no longer merged
      return Object.assign(hc, {
        // HashedCache
        file,
        hash,
        analyzed,
        json,
        jsonFromPath: async (path: string) => {
          const hash = await file(path)
          if (hash === undefined) return undefined
          return json(hash.cacheId)
        },
        transpiled: file_transpiled(hc),
        // cached for this run
        filetype,
        node_modules_containing_file,
      })
    },
  }
}
