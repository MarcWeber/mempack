// import { existsSync, lstatSync, readFileSync } from 'fs';
import { ImportType } from "fuse-box/resolver/resolver";
import * as glob from "glob"
import * as path from "path";
import { AsyncCacheResult, file_analysed_a_h, file_as_json_a_h, file_as_string_a_h, file_type_a_h, get_async } from "src/Cache";
import { get_path, ifu, promise_to_callback } from "ttslib/U";
import { getSupportedCodeFixes } from "typescript";
import ts from "typescript"
import { Cache } from "./Cache"
import * as CacheNU from "./CacheNU"

// TODO: more testing, eg the browser stuff
/* nested dependencies
   Thus look into node_modules of the depending files instnead of
*/
export interface GCTX { // global context
    event_file_found: Array<(path: string, hash: string) => void>,
    file_as_json_a_h: file_as_json_a_h,
    file_as_string_a_h: file_as_string_a_h,
    file_analysed_a_h: file_analysed_a_h,
    file_type_a_h: file_type_a_h
    log: (msg: string) => void,
    throwError: boolean,
    resolveImplementation: ResolveImplementation,
}

type AbsolutePath = string;

function pathRegex(input: string) {
  const str = input.replace(/\*/, "(.*)").replace(/[\-\[\]\/\{\}\+\?\\\^\$\|]/g, "\\$&");
  return new RegExp(`^${str}`);
}

export type Reference =
    {file: AbsolutePath}
  | {package: AbsolutePath}

interface References {
    // after resolving connect items
    references: Reference[], // result from fast analysis
    referencedBy: Reference[],
}

class ExceptionResolveResult {
    // while this might be bad style ist actually pretty nice
    // no more returns to be written no matter how many levels deep the code is
   constructor(public result: ResolveImpelmentationResult) {}
}

export type File = {
    type: "file",
    path: AbsolutePath,
    resolved?: boolean,
    repositoryPath?: AbsolutePath,
    // traget -> target file
    resolvedFiles: {[key: string]: ResolveImpelmentationResult}
    // get from cache fast_analysis
    package?: string; // drop this ?
} & References

export type Package = {
    type: "package",
    name: string,
    path: AbsolutePath,
    resolved?: boolean,
    version: string,
} & References

interface CacheTypes {
    file_by_path: {key: AbsolutePath, value: File},
    // package_by_path: {key: AbsolutePath, value: Package},
    // ts_compileroptions_paths_matches: {key: string, value: AbsolutePath[]},
    // // if repo_path is given only look within that node_modules/*
    // node_modules_containing_file: {key:{path: string, repo_path?: string}, value: AbsolutePath[]}
}

interface CacheTypesAsync {
    package_by_path: {key: AbsolutePath, value: Package},
    ts_compileroptions_paths_matches: {key: string, value: AbsolutePath[]},
    // if repo_path is given only look within that node_modules/*
    node_modules_containing_file: {key: {path: string, repo_path?: string}, value: AbsolutePath[]},
}

export class Stale {
    public stale: boolean = false; ;

    constructor(public notifications: Array<() => void>) {
        notifications.push(() => { this.stale = true; })
        this.stale = true;
    }

}

export interface Context {
    // track issues
    entries: string[],
    resolveOptions: ResolveOptions,
    warnings: string[],
    errors: string[],
    debugs: string[],

    stale: Stale, // if stale abort all operations

    warning: (x: string) => void,
    error: (x: string) => void,
    debug: (x: string) => void,

    cache: <Z extends (keyof CacheTypes | keyof CacheTypesAsync)> (x: Z) =>
      Z extends keyof CacheTypes
      ? ((key: CacheTypes[Z]["key"]) => CacheTypes[Z]["value"])
      : (
          Z extends keyof CacheTypesAsync
          ? ((key: CacheTypesAsync[Z]["key"]) => Promise<CacheTypesAsync[Z]["value"]>)
          : never
      )

    add_cache: <Z extends (keyof CacheTypes | keyof CacheTypesAsync)>
    (k: Z, f:
        Z extends keyof CacheTypes
        ? (key: CacheTypes[keyof CacheTypes]["key"]) => CacheTypes[keyof CacheTypes]["value"]
        : (
          Z extends keyof CacheTypesAsync
          ? (key: CacheTypesAsync[Z]["key"]) => Promise<CacheTypesAsync[Z]["value"]>
          : never
        ),
    ) => void
    ,

    // CACHE
    // given 'foo/bar' return matching path locations for compilerOptions.paths setting
    // ts_compileroptions_paths_matches: (x:string) => AbsolutePath[],

    // METHODS
    // query context functions
    // path_to_entry returns require path from entry point to given module so that you know why its used at all
    path_to_entry: (path: AbsolutePath) => Promise<string[]>,
    referenceToString: (r: Reference) => string
    referencedBy: (r: Reference) => Promise<Reference[]>,
    files: () => IterableIterator<File>,
    files_with_requires_to_string: () => string,
    // foreachfile: (f: (file: File) => void) => void,
    errors_and_warnings: () => string[],
    errors_and_warnings_log: () => void,
    resolveResultByPath: (p: string)  => void,
}

export type package_by_path_a_h = (path: string) => Promise<Package>
export const package_by_path_a_h: (cachenu: CacheNU.Cache<{get_async: CacheNU.get_async}>, cache: {file_as_json_a_h: file_as_json_a_h}) => package_by_path_a_h = (cachenu, cache) => (path) => {
    const id = `package_by_path_a_h:${path}`
    return cachenu.get_async(id, async () => {
        const package_json = (await cache.file_as_json_a_h(path).value)
        const name: string = package_json.value.name
        const version: string = package_json.value.version
        return { path, name, version, type: "package" as "package", references: [], referencedBy: [] }
    })
}

export const new_context = (opts: {ctx: GCTX, entries: string[], throwError?: boolean, resolveOptions: ResolveOptions}): Context => {
    const map = new Map<any, any>()
    const _warnings: string[] = []
    const _errors: string[] = []
    const _debugs: string[] = []
    const paths_regex: Array<{r: RegExp, targets: string[]}> = []

    // const cache = CacheNU.new_cache();
    // CacheNU.initCache(cache, cache)

    // @ts-ignore
    for (const [k, v] of Object.entries(get_path(opts.resolveOptions, "tsconfig", "compilerOptions", "paths", {}))) {
        paths_regex.push({ r: pathRegex(k), targets:  v as string[] })
    }

    const ctx: Context = {
        entries: opts.entries,
        resolveOptions: opts.resolveOptions,
        // should be readonly
        warnings: _warnings,
        errors: _errors,
        debugs: _debugs,
        stale: new Stale([]),
        warning: (x: string) => { _warnings.push(x) },
        debug: (x: string) => { _debugs.push(x) },
        error: (x: string) => {
            if (opts.throwError)
                throw new Error(x)
            _errors.push(x)
        },
        path_to_entry: async (path: AbsolutePath) => {
            const result: string[] = []
            let ref: Reference = {file: path}
            while (true) {
               const rs: Reference[] = await (ctx.referencedBy(ref))
               if (rs.length > 0) {
                 result.push(ctx.referenceToString(rs[0]))
                 ref = rs[0]
               } else return result
            }
        },
        referenceToString: (r: Reference) => {
            if ("file" in r)
                return r.file
            if (r.package)
                return r.package
            throw new Error("unknown reference")
        },
        referencedBy: async (r: Reference) => {
            if ("file" in r)
                return ctx.cache("file_by_path")(r.file).referencedBy

            if (r.package)
                return (await ctx.cache("package_by_path")(r.package)).referencedBy
            throw new Error("unknown reference")
        },
        cache: (x: any) => map.get(x),
        add_cache: (k, f) => {
            const kvmap = new Map()
            map.set(k, (key: any) => {
                if (typeof key === "object") key = JSON.stringify(key)
                if (!kvmap.has(key))
                  kvmap.set(key, f(key))
                return kvmap.get(key)
            })
        },

        files_with_requires_to_string: () => {
            const lines: string[] = []
            for (const f of ctx.files()) {
                lines.push(`${f.path} ${JSON.stringify(f.resolvedFiles)}`)
            }
            return lines.join("\n")
        },

        files: () => {
            return (function* it() {
                const done: { [key: string]: boolean } = {}
                const todo = [...ctx.entries]
                while (todo.length > 0) {
                    const next = todo.shift() as string
                    if (next in done) continue
                    done[next] = true
                    const file = ctx.cache("file_by_path")(next)
                    yield file;
                    for (const v of Object.values(file.resolvedFiles)) {
                        if (v && v.path)
                            todo.push(v.path)
                    }
                }
            })()

        },

        // foreachfile: async (f: (file: File) => void) => {
        //     const done: { [key: string]: boolean } = {}
        //     const todo = [...ctx.entries]
        //     while (todo.length > 0) {
        //         const next = todo.shift() as string
        //         if (next in done) continue
        //         done[next] = true
        //         const file = ctx.cache("file_by_path")(next)
        //         f(file)
        //         for (const v of Object.values(file.resolvedFiles)) {
        //             if (v && v.path)
        //                 todo.push(v.path)
        //         }
        //     }
        // },

        errors_and_warnings: () => {
            const add = (label: string, key: "errors" | "warnings") => [`${label}: ${ctx[key].length}`, ...ctx[key]]
            return [...add("ERRORS", "errors"), ...add("WARNINGS", "warnings")]
        },
        errors_and_warnings_log: () => {
            for (const v of ctx.errors_and_warnings()) {
                console.log(v);
            }
        },
        resolveResultByPath: (p: string) => {
            throw new ExceptionResolveResult({ path: p, analyse: /(js|jsx|ts|tsx)$/.test(p) ? "fast_analysis" : undefined});
        },
    }
    ctx.add_cache("file_by_path",    (path: AbsolutePath): File => ({path, type: "file", references: [], referencedBy: [], resolvedFiles: {}  }))
    ctx.add_cache("ts_compileroptions_paths_matches", async (x: string) => {
        const result: string[] = []
        for (const v of paths_regex) {
            const match = v.r.exec(x)
            if (match) {
                for (const target of v.targets) {
                  result.push(target.replace("*", match[1])) // can't test for existance, extensions missing
                }
            }
        }
        return result
    } )
    ctx.add_cache("node_modules_containing_file", async (p: {path: string, repo_path?: string|undefined}) => {
        const c = p.path.replace(/[/\/].*/, "")
        const r: string[] = []
        const node_modules: string[] = p.repo_path ? [p.repo_path] : opts.resolveOptions.node_modules
        for (const nm of node_modules) {
            if (await opts.ctx.file_type_a_h(path.join(nm, c)).value === "file")
              r.push(nm)
        }
        return r
    })
    return ctx
}

export interface ResolveOptions {
    // I think universal should be avoided
    target: "browser" | "server" | "electron" | "universal"
    node_modules: AbsolutePath[],
    tsconfig?: {
        path: string
        config: ts.CompilerOptions,
    },
}

interface ResolveImplementationOptions {thing: { type: ImportType; statement: string }, source: File, resolveAttempt: ResolveAttempt, ctx: Context}

interface ResolveImpelmentationResult {
    path?: AbsolutePath|false, /* false means ignore (package.json browser key)*/
    analyse?: "fast_analysis",
    node?: boolean,
}
type ResolveImplementation = (gctx: GCTX, o: ResolveImplementationOptions) => Promise<void> // throws ExceptionResolveResult

type ResolveAttempt = (x: string) => void

const require_like = async (ctx: GCTX, o: ResolveImplementationOptions, path: string, extensions: string[]): Promise<void> => {
    o.resolveAttempt("require_like " + path)
    // try all extenions, then try /index/*

    //  assume extension is missing
    for (const e of [...extensions, ""]) {
        const p2 = `${path}/index${e}`
        o.resolveAttempt(p2)
        if (await ctx.file_type_a_h(p2).value === "file")
            o.ctx.resolveResultByPath(p2)

        const p = `${path}${e}`
        o.resolveAttempt(p)
        if (await ctx.file_type_a_h(p).value === "file")
            o.ctx.resolveResultByPath(p)
    }
}

export const fileresolver_nodeserver: ResolveImplementation = async (ctx, o) => {
    const modules = [ "http", "events", "util", "domain", "cluster", "buffer", "stream", "crypto", "tls", "fs", "string_decoder", "path", "net", "dgram", "dns", "https", "url", "punycode", "readline", "repl", "vm", "child_process", "assert", "zlib", "tty", "os", "querystring" ]
    if (["server", "universal"].includes(o.ctx.resolveOptions.target) &&  modules.includes(o.thing.statement))
        throw new ExceptionResolveResult({ node: true })
}

export const fileresolver_default: (extensions: string[]) => ResolveImplementation = (extensions: string[]) => {
    return async (ctx, o) => {
        console.log("resolving", o.thing.statement)
        const statement = o.thing.statement

        if (statement[0] === ".") {
            // relative
            await require_like(ctx, o, path.join(path.dirname(o.source.path), statement), extensions);
            return;
        }

        const pap = statement.split("/", 1) // [package, path]

        for (const nm of await o.ctx.cache("node_modules_containing_file")({path: pap[0] /* repoPath TODO */})) {

            const nm_p = path.join(nm, pap[0])

            const package_ = (await ctx.file_as_json_a_h(nm_p).value).value

            if (package_ && package_.browser) {
                // https://github.com/defunctzombie/package-browser-field-spec
                const browser = package_.broswer
                if (typeof browser === "string" && pap.length === 1) {
                    await require_like(ctx, o, path.join(nm_p, package_.browser), extensions)
                }
                if (typeof browser === "object") {
                    for (const [k, v] of browser) {
                        if (k.replace(/^\.[\/\\]/, "") === pap[1]) {
                            await require_like(ctx, o, path.join(nm_p, v), extensions)
                            break
                        }
                    }
                }
            }

            if (pap.length === 1 && package_) {
                // only name, check main or types field of _package
                if ((extensions.includes(".ts") || extensions.includes(".tsx")) && "types" in package_) {
                    await require_like(ctx, o, path.join(nm_p, package_.types.replace(/\.d\.ts$/, ".js")), extensions)
                    o.ctx.warning(`${nm_p}'s package.json file has key types = ${package_.types}, but that wasn't found`)
                }

                if ((extensions.includes(".js") || extensions.includes(".jsx")) && "main" in package_) {
                    await require_like(ctx, o, path.join(nm_p, package_.main), extensions)
                    o.ctx.warning(`${nm_p}'s package.json file has key types = ${package_.main}, but that wasn't found`)
                }
            }

            // now try to find file the normal way
            // ggrequire_like(o, path.join(nm, statement), extensions)
        }
    }

}

export const defaultResolveImplementation = (options: ResolveOptions): ResolveImplementation => {
    const resolvers: ResolveImplementation[] = []
    resolvers.push(fileresolver_nodeserver)

    resolvers.push(fileresolver_default([".tsx", ".ts", ".jsx", ".js"]))

    // if this dosen't fit your needs role your own
    return async (ctx, o: ResolveImplementationOptions) => {
        for (const v of resolvers) {
            const r = await v(ctx, o)
        }
        return;
    }
}

export const resolveRecursive = async (gctx: GCTX, dependencyState: Context, thing: File|Package, analysisImplementation: "fast_analysis", resolveImplementation: ResolveImplementation) => {
    if (thing.type === "file") {
        if (thing.resolved) return
        thing.resolved = true; // prevent cycles
        const fa = (await (gctx.file_analysed_a_h(thing.path).value)).value

        const resolve = async (imp: {type: ImportType, statement: string}) => {
            const resolveAttempts: string[] = []
            const resolveAttempt = (x: string) => { resolveAttempts.push(x) }
            try {
                await resolveImplementation(gctx, { ctx: dependencyState, resolveAttempt, source: thing, thing: imp })
                dependencyState.error(`\nrequirement ${JSON.stringify(imp)} from ${thing.path} could not be resolved,\n tried\n${resolveAttempts.join("\n")}\n, file required from\n${(await dependencyState.path_to_entry(thing.path)).join("\n")}`)
            } catch (e) {
                if (e instanceof ExceptionResolveResult) {
                    const r = e.result
                    thing.resolvedFiles[JSON.stringify(imp)] = r
                    if (!r.path) return;
                    const file = dependencyState.cache("file_by_path")(r.path)
                    // if ('package' in r)
                    //     file.package = r.package
                    file.referencedBy.push({ file: thing.path })
                    thing.references.push({ file: file.path })
                    if (r.analyse)
                        await resolveRecursive(gctx, dependencyState, file, r.analyse, resolveImplementation)
                    // if file belongs to a package, get its dependencies, too ?
                    // but tihs should happen automatically
                } else {
                  throw e
                }
            }
        }
        await Promise.all((fa.imports || []).map((i) => resolve(i)))
    } else {
        throw new Error("TODO")
    }
}

// build a dependency which can then be used for processing / assembling and more
export const dependencyTree = async (
    gctx: GCTX,
    entries: string[],
    resolveOptions: ResolveOptions,
): Promise<Context>  => {
    const dependencyState = new_context({ctx: gctx, entries, resolveOptions})
    await Promise.all(entries.map((entry) => {
        const file = dependencyState.cache("file_by_path")(entry)
        return resolveRecursive(gctx, dependencyState, file, "fast_analysis", gctx.resolveImplementation)
    }))
    return dependencyState
}
