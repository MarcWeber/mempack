/* resolve dependencies
 * beacuse several projects / linked modules might have their own node_modules
 * duplicate code in the result is likely
 * ./normalizeddependencies.ts will eliminate them
 */

// import { existsSync, lstatSync, readFileSync } from 'fs';
import * as Bluebird from "bluebird"
import chalk from "chalk"
import { pseudoRandomBytes } from "crypto";
import fs from "fs"
import { options } from "fuse-box/_experimental/typescript/transpileModule";
import { ImportType } from "fuse-box/resolver/resolver";
import * as glob from "glob"
import * as path from "path";
import { exception_to_str } from "ttslib/exception";
import { get_path, ifu, promise_to_callback, throw_ } from "ttslib/U";
import ts from "typescript"
import { getSupportedCodeFixes } from "typescript";
import { promisify } from "util";
import { FSCache } from "./FSCache";
import { GlobalState, GlobalStateCacheRoots, Snapshot } from "./GlobalState";
import { CacheId, CacheRoots } from "./HashedCache";
import { log } from "./log";
import { TErrorString, terrorString } from "./Types";
import { cachedByKeyAsync, force_absolute, xx } from "./Util";

export type Target = "browser" | "node" | "electron" // universal doesn't make sense because different .js files get selected!

export type Hash = string
export type AbsolutePath = string;
export type ResolveAttempt = (x: string) => void
export interface Import { type: ImportType; statement: string } // See IFastAnalysis.imports

export interface TSConfigWithPath {
    path: string,
    tsconfig: {compilerOptions: ts.CompilerOptions}
}

export interface ResolveOptions {
    ss: Snapshot,
    error: (e: string) => void,
    warning: (e: string) => void,
    target: Target,
    node_modules: AbsolutePath[],
    paths_matches: (relativePath: string) => AbsolutePath[] // compilerOptions.paths resolution
    tsconfig?: TSConfigWithPath
}

function pathRegex(input: string) {
  const str = input.replace(/\*/, "(.*)")
  return new RegExp(`^${str}$`);
}

export const preparedResolvePaths = (baseUrlTsConfig: string, baseUrl: string|undefined, paths: {[key: string]: string[]}) => {
    const prepared: Array<({exact: string} | {regex: RegExp}) & {targets: string[]}> = []

    const match_asterisk = /\*/;

    for (const [k, v] of Object.entries(paths || {})) {
        if (match_asterisk.test(k)) {
            prepared.push({
                regex: new RegExp(`^${k.replace("*", "(.*)")}$`),
                targets: v,
            })
        } else {
            prepared.push({
                exact: k,
                targets: v,
            })
        }
    }

    const rel = (p: string ) => path.join(baseUrlTsConfig, baseUrl as string, p)

    return (thing: string) => {
        let r: string[] =  [];
        for (const v of prepared) {
            if ("exact" in v && v.exact === thing) {
                r = [...r, ...v.targets.map(rel)]
            } else if ("regex" in v) {
                const matches = thing.match(v.regex)
                if (matches) {
                    r = [...r, ...v.targets.map((x) => rel(x.replace("*", matches[1])))]
                }
            }
        }
        return r
    }
}

export const resolveOptions = (opts: {gS: GlobalState, target: Target, node_modules?: string[], tsconfig?: TSConfigWithPath, error?: (e: string) => void, warning?: (e: string) => void,
}): ResolveOptions => {
    const ss = opts.gS.snaphshottedCache()
    const paths_regex: Array<{pattern: string, r: RegExp, targets: string[]}> = []
    const tsconfig = opts.tsconfig
    const compilerOptions = get_path(tsconfig, "tsconfig", "compilerOptions", {})
    const prp = preparedResolvePaths(get_path(tsconfig, "path", ""), get_path(compilerOptions, "baseUrl", undefined), get_path(compilerOptions, "path", {}))
    for (const [k, v] of Object.entries(get_path(opts, "tsonfig", "tsconfig", "compilerOptions", "paths", {}))) {
        paths_regex.push({ pattern: k, r: pathRegex(k), targets:  v as string[] })
    }
    return {
        ss,
        error: opts.error || ((e: string) => { console.log("ERROR", e) }),
        warning: opts.error || ((e: string) => { console.log("ERROR", e) }),
        target: opts.target,
        node_modules: opts.node_modules || ["./node_modules"],
        tsconfig: opts.tsconfig,
        paths_matches: prp,
    }
}

export interface ResolveImplementationOptions {
    thing: Import,
    source: AbsolutePath,
    resolveAttempt: ResolveAttempt,
    }
export type Dependencies = ReturnType<typeof dependencies>
export type ResolveImplementation = (o: ResolveImplementationOptions) => Promise<void> // throws ExceptionResolveResult
export interface ResolveImplmentationResult {
    path?: AbsolutePath|false, /* false means ignore (package.json browser key)*/
    analyse ?: "fast_analysis",
    node?: boolean, // for node internal modules like fs
}
class ExceptionResolveResult {
    // while this might be bad style ist actually pretty nice
    // no more returns to be written no matter how many levels deep the code is
   constructor(public result: ResolveImplmentationResult) {}
}

export interface ResolvedDependency {
    import: Import,
    node: AbsolutePath|false|TErrorString,
}
export const resolvedDependencyToString = (rd: ResolvedDependency) => {
   // resolvedDependencyToString
   let resolved: string
   const n = rd.node
   if (typeof n === "string") {
       resolved = n
   } else if (n === false) {
       resolved = "false"
   } else if ("error" in n) {
       resolved = n.error
   } else throw new Error(`bad`)
   return `${JSON.stringify(rd.import)} -> ${resolved}`
}

export interface DependencyTreeNode {
    path: string,
    fileHash: string,
    resolved: ResolvedDependency[],
    // maybe add errors/ warnings per node here ?
}

export interface DependencyTree {
    // links by path so that it can be serialized easily
    entryPoints: AbsolutePath[],
    tree: {[key: string]: DependencyTreeNode|TErrorString}
}

export const dependencyTreeToString = (tree: DependencyTree) => {
    const lines: string[] = []
    const seen: {[key: string]: undefined} = {}
    const todo: string[] = tree.entryPoints
    while (true) {
        const path = todo.shift()
        if (path === undefined) break;
        if (path in seen) continue;
        seen[path] = undefined

        lines.push(path)
        const node = tree.tree[path]
        if (node === undefined) {
            lines.push("  node undefined ??")
            continue;
        }
        if ("error" in node) {
            lines.push(`  ${node.error}`)
            break
        }
        for (const v of node.resolved) {
            lines.push(`  ${resolvedDependencyToString(v)}` )
            if (typeof v.node === "string") todo.push(v.node)
        }
    }
    return lines.join("\n")
}

export const walkDependencyTree = (entryPoints: AbsolutePath[], tree: DependencyTree, f: (n: DependencyTreeNode|TErrorString) => void ) => {
    const seen: {[key: string]: 1} = {}
    const walk = (p: AbsolutePath) => {
        if (p in seen) return;
        seen[p] = 1
        const n = tree.tree[p]
        if (n === undefined) return;
        f(n)
        if ("error" in n) return
        for (const v of n.resolved) {
            if (typeof v.node === "string") walk(v.node)
        }
    }
    entryPoints.map(walk)
}

export const filesAndHashesOfDependencyTree = (entryPoints: string[], tree: DependencyTree): {[key: string]: Hash} => {
    const r: ReturnType<typeof filesAndHashesOfDependencyTree> = {}
    walkDependencyTree(entryPoints, tree, (n) => {
        if ("fileHash" in n) r[n.path] = n.fileHash
    })
    return r
}

export const dependencies = (o: ResolveOptions, resolveImplementation: ResolveImplementation) => {

    // using promises so if resolveDependencies gets called multiple times that the work gets shared before results are ready

    const cache: {[key: string]: Promise<void>} = {}
    const tree: DependencyTree["tree"] = {}

    // the returned tree can contain more than the entryPoints.
    const resolveDependencies = async (entryPoints: AbsolutePath[]): Promise<DependencyTree> => {
            log(`resolving dependencies for ${entryPoints}`)

            const todos = [...entryPoints]

            const resolveDependencies = async (
                path: AbsolutePath,
                paths: AbsolutePath[],
                ): Promise<void> => {

                if (paths.includes(path)) {
                    log(`circle detected ${path} ${paths.join(", ")}`)
                    return;
                }

                const error = (msg: string) => {
                    const m = `${msg}${paths === undefined ? "" : `\nfile required from\n${paths.join("\n")}`}`
                    return terrorString(m)
                }

                if (!(path in cache)) {
                    cache[path] = (async () => {
                        if (/Types\.ts/.test(path)) try { throw_("x") } catch (e) { }
                        const fileHash = await o.ss.hash(path)
                        log(`analying ${path} ${paths.join(",")}`)
                        const file = await o.ss.get(fileHash)
                        const analysed = (await o.ss.analyzed(fileHash)).item
                        log(`analysed ${path} ${JSON.stringify(analysed)}`)

                        const resolve: (i: Import) => Promise<ResolvedDependency> = async (i) => {
                            log(`resolving import for ${JSON.stringify(i)}`)
                            const resolveAttempts: string[] = []
                            const resolveAttempt = (x: string) => { resolveAttempts.push(x) }
                            try {
                                await (resolveImplementation({ thing: i, source: path, resolveAttempt }))
                                log(`${JSON.stringify(i)} not found`)
                                return { import: i, node: error(`requirement ${JSON.stringify(i)} from ${path} could not be resolved, \n tried\n${resolveAttempts.join("\n")}\n`) }
                            } catch (e) {
                                if (e instanceof ExceptionResolveResult) {
                                    log(`${JSON.stringify(i)} found`)
                                    const result = e.result
                                    const p = result.path
                                    if (!(result.analyse)) error(`!r.analyse not implemented yet`)
                                    if (p === false || p === undefined) return { import: i, node: false }
                                    return { import: i, node: p }
                                } else {
                                    log(`${JSON.stringify(i)} rethrowing exception ${exception_to_str(e)}`)
                                    throw e
                                }
                            }
                        };
                        log(`resolving ${JSON.stringify(analysed.imports)} of ${path}`)
                        const resolved = await Promise.all((analysed.imports || []).map(resolve))
                        log(`resolving ${JSON.stringify(analysed.imports)} of ${path} done`)
                        tree[path] = {
                            path,
                            fileHash,
                            resolved,
                        }
                    })()
                }
                await cache[path]
            }

            return new Promise((r, j) => {

                const running = new Set<Promise<any>>()
                const seen: {[key: string]: 1} = {}

                const resolve = (path: string, paths: string[]= []) => {
                    log(`DEPENDENCIES: resolving ${path}, running ${running.size}`)
                    if (path in seen) return;
                    seen[path] = 1
                    const p = resolveDependencies(path, paths)
                    running.add(p)

                    const finish = () => {
                        if (running.size === 0) {
                            r({
                                entryPoints,
                                tree,
                            })
                        }
                    }

                    p.then(
                        (x) => {
                            running.delete(p);
                            const n = tree[path]
                            log(`DEPENDENCIES ok ${path}, running ${running.size}, got ${JSON.stringify(n)}`)
                            if (n && "resolved" in n)
                                n.resolved.map((x) => { if (typeof x.node === "string") resolve(x.node, [path, ...paths]) })
                            finish()
                        },
                        (x) => {
                            running.delete(p);
                            log(`DEPENDENCIES failed ${path}, reason ${x}`)
                            tree[path] = terrorString(x)
                            finish()
                        },
                    )
                }
                todos.map((x) => resolve(x))
            })
       }
    return {
        resolveDependencies,
    }
}

export const fileresolver_nodeserver: (ro: ResolveOptions) => ResolveImplementation = (ro) => async (o) => {
    const modules = [ "http", "events", "util", "domain", "cluster", "buffer", "stream", "crypto", "tls", "fs", "string_decoder", "path", "net", "dgram", "dns", "https", "url", "punycode", "readline", "repl", "vm", "child_process", "assert", "zlib", "tty", "os", "querystring" ]
    if (["node"].includes(ro.target) &&  modules.includes(o.thing.statement))
        throw new ExceptionResolveResult({ node: true })
}

const resolveResultByPath = (p: string) => {
    throw new ExceptionResolveResult({ path: p, analyse: /(js|jsx|ts|tsx)$/.test(p) ? "fast_analysis" : undefined });
}

const require_like = async (ro: ResolveOptions, rio: ResolveImplementationOptions, path: string, extensions: string[]): Promise<void> => {
    rio.resolveAttempt("require_like " + path)
    // try all extenions, then try /index/*

    //  assume extension is missing
    for (const e of [...extensions, ""]) {
        const p2 = `${path}/index${e}`
        rio.resolveAttempt(p2)
        if (await ro.ss.filetype(p2) === "file")
            resolveResultByPath(p2)

        const p = `${path}${e}`
        rio.resolveAttempt(p)
        if (await ro.ss.filetype(p) === "file")
            resolveResultByPath(p)
    }
}

export const fileresolver_default: (ro: ResolveOptions, extensions: string[]) => ResolveImplementation = (ro, extensions) => {
    // as alternative typescripts resolution could / should be used ?
    return async (o) => {
        const statement = o.thing.statement
        // use ts instead ?
        // ts.resolveModuleName(o.thing.statement, o.source.path,  )

        const p = JSON.stringify(o.thing)

        if (statement[0] === ".") {
            // relative
            await require_like(ro, o, path.join(path.dirname(o.source), statement), extensions)
            return;
        }

        const pap = statement.split("/", 1) // [package, path]

        const containing = await ro.ss.node_modules_containing_file({node_modules: ro.node_modules, path: pap[0] /* repoPath TODO */})

        log(`looking for ${pap[0]} found ${containing}`)

        for (const nm of containing) {

            const nm_p = path.join(nm, pap[0])

            const package_path = path.join(nm_p, "package.json")
            const package_ = (await ro.ss.jsonFromPath(package_path)).item
            log(`PACKAGE OF ${package_path} ${JSON.stringify(package_)}`)

            if (package_ && package_.browser) {
                // https://github.com/defunctzombie/package-browser-field-spec
                const browser = package_.broswer
                if (typeof browser === "string" && pap.length === 1) {
                    await require_like(ro, o, path.join(nm_p, package_.browser), extensions)
                }
                if (typeof browser === "object") {
                    for (const [k, v] of browser) {
                        if (k.replace(/^\.[\/\\]/, "") === pap[1]) {
                            await require_like(ro, o, path.join(nm_p, v), extensions)
                            break
                        }
                    }
                }
            }

            if (pap.length === 1 && package_) {
                // only name, check main or types field of _package
                if ((extensions.includes(".ts") || extensions.includes(".tsx")) && "types" in package_) {
                    await require_like(ro, o, path.join(nm_p, package_.types.replace(/\.d\.ts$/, ".js")), extensions)
                    ro.warning(`${nm_p}'s package.json file has key types = ${package_.types}, but that wasn't found`)
                }

                if ((extensions.includes(".js") || extensions.includes(".jsx")) && "main" in package_) {
                    await require_like(ro, o, path.join(nm_p, package_.main), extensions)
                    ro.warning(`${nm_p}'s package.json file has key types = ${package_.main}, but that wasn't found`)
                }
            }

            // now try to find file the normal way
            await require_like(ro, o, path.join(nm, statement), extensions)
        }

        let paths_matches = ro.paths_matches(o.thing.statement)
        paths_matches = ro.paths_matches(o.thing.statement)
        paths_matches = ro.paths_matches(o.thing.statement)
        for (const v of paths_matches) {
            log(`ttslib ${o.thing.statement} looking at ${v} using require`)
            await require_like(ro, o, v, extensions)
        }
    }

}

export const defaultResolveImplementation = (ro: ResolveOptions): ResolveImplementation => {
    const resolvers: ResolveImplementation[] = []
    resolvers.push(fileresolver_nodeserver(ro))
    resolvers.push(fileresolver_default(ro, [".tsx", ".ts", ".jsx", ".js"]))
    // if this dosen't fit your needs role your own
    return async (o: ResolveImplementationOptions) => {
        for (const v of resolvers) {
            const r = await v(o)
        }
        return;
    }
}
