// /* deprecated, is being splict into
//    HashedCache
//    and
//    FSCache
// */

// // import {any, Promise} from "bluebird"
// import * as bluebird from "bluebird"
// import console = require("console");
// import deepequal from "deep-equal"
// import fs from "fs"
// import { fastAnalysis, IFastAnalysis } from "fuse-box/analysis/fastAnalysis";
// import JSON5 from "json5"
// import { string } from "prop-types";
// import { stringify } from "querystring";
// import { run_tests_with_dependencies } from "ttslib/TestRunnerWithDependencies";
// import { textChangeRangeIsUnchanged, TranspileOutput } from "typescript";
// import ts from "typescript"
// import { promisify } from "util"
// import { dependencyTree } from "./dependencies";
// import { log } from "./log";
// import { force_absolute, strcmp, xx } from "./Util";

// const readFile = promisify(fs.readFile)
// const stat = promisify(fs.stat)

// /* smart cache
//   derived contents are linked to source. Even if chokidar says 'file changed' because :w!
//   the eql comparison will catch it and not destroy derived contents unless file contents changed

//   TODO: remove all the dependency code .. it should be part of HashedCache
// */

// export interface Hashed<T> {
//     hash: string,
//     value: T,
// }

// export interface ID {name: string, key: any}

// export interface CacheItem<T> {
//     p: Promise<T>,
//     hash: Promise<string>,
//     dependencies: ID[],
//     dependencyHashes: Array<Promise<string>>,
//     derived: ID[],
//     valid:
//       true
//     | false, // must be revalidated, eg dependencies might have changed
// }

// export interface CacheImplementation<Key, Result> {
//     name: string,
//     dependendencies: (k: Key) => ID[],
//     promise: (k: Key, dependency_values: any[]) => Promise<Result>,
//     pure: boolean, // true if dependencies have same hash no hash of own result needs to checked
//     watcher?: (k: Key) => void
//     hash_fun_result?: (r: Result) => string,
// }
// // tslint:disable-next-line: interface-over-type-literal
// export type CacheImplementationKeyResult<T extends CacheImplementation<any, any>> = T extends CacheImplementation<infer K, infer R> ? {key: K, result: R} : never
// export interface CacheImplementations {[key: string]: CacheImplementation<any, any>}

// export interface Cache<Is extends CacheImplementations> {
//     running_promises: Set<Promise<any>>,
//     cache: {[key: string]: CacheItem<any>},
//     implementations: CacheImplementations,
//     invalidate: (id: ID) => void,
//     recurse_derived: any,
//     get: <I extends keyof Is>(implementation: I) =>
//     (key: CacheImplementationKeyResult<Is[I]>["key"] ) => {p: Promise<CacheImplementationKeyResult<Is[I]>["result"]>, hash: Promise<string>}
// }

// export const new_cache: <Is extends CacheImplementations>(implementations: Is) => Cache<Is>
//  = <Is extends CacheImplementations>(implementations: Is) => {

//     log(`CACHE: new_cache`)
//     const str_of_key = (name: string, key: string ) => `${name}:${typeof key === "string" ? key : JSON.stringify(key)}`
//     const running_promises = new Set();
//     const cache: Cache<any>["cache"] = {};

//     const recurse_derived = (id: ID, f: (id: ID, cr: CacheItem<any>) => void) => {
//         const kk = str_of_key(id.name, id.key)
//         const cr = cache[kk]
//         if (cr === undefined) return;
//         cr.derived.forEach((id) => recurse_derived(id, f))
//         f(id, cr)
//     }

//     const invalidate = (id: ID) => {
//         recurse_derived(id, (id, i) => { i.valid = false; })
//     }
//     const get_updated_cache_item: (id: ID) => CacheItem<any> = (id) => {
//         const kk = str_of_key(id.name, id.key)
//         const impl = implementations[id.name]
//         if (impl === undefined) throw new Error(`impl ${id.name} not found in cache, implementations: ${Object.keys(implementations).join(",")}`)
//         if (impl.watcher) impl.watcher(id.key);
//         const hash_fun_result = impl.hash_fun_result ? impl.hash_fun_result : (r: any) => xx(typeof r === "string" ? r : JSON.stringify(r))
//         // TODO: test dependency order, should be same
//         const dependencies = impl.dependendencies(id.key)
//         // dependencies.sort((a, b) => strcmp(JSON.stringify(a), JSON.stringify(b)))
//         const d_res = dependencies.map((x) => get_updated_cache_item(x))
//         const d_hashes = d_res.map((x) => x.hash)
//         const p_p = async () => {
//             log(`CACHE: creating promise for ${id.name} ${id.key}`)
//             return impl.promise(id.key, await Promise.all(d_res.map((x) => x.p)))
//         }
//         const hash_fun_strings = (d_hashes: Array<Promise<string>>) => (async () => (await Promise.all(d_hashes)).join("|"))()

//         if (kk in cache) {
//             const i = cache[kk]
//             if (JSON.stringify(i.dependencies) !== JSON.stringify(dependencies))
//                 throw new Error("dependencies should never change for same key")
//             log(`CACHE: ${id.name}:${id.key} in cache, valid: ${i.valid ? "y" :  "n"}`)
//             if (!i.valid || d_res.find((x) => !x.valid)) {
//                 // must revalidate
//                 const p_old = i.p
//                 const hash_old = i.hash
//                 const p_and_hash = (async () => {
//                     if (impl.pure) {
//                         // if dependencies have same hashes, then we we can reuse old cache result (thus old promise)
//                         const old_new = await Promise.all([
//                             hash_fun_strings(i.dependencyHashes),
//                             hash_fun_strings(d_res.map((x) => x.hash)),
//                         ])
//                         log(`CACHE: ${id.name}:${id.key} pure, dependency hashes: old_new ${old_new[0]} ${old_new[1]}`)
//                         if (old_new[0] === old_new[1]) {
//                             log(`CACHE: ${id.name}:${id.key} pure, hashes equal of deps returning old`)
//                             // hashes equal, eg same file was written, thus everything ok, can use old promise
//                             return { p: p_old, hash: hash_old }
//                         } else {
//                             // @ts-ignore
//                             if ("cancel" in p_old) p_old.cancel(); if ("cancel" in hash_old) hash_old.cancel()
//                             // changed, must revalidate
//                             log(`CACHE: ${id.name}:${id.key} dependencies changed ..`)
//                             return {
//                                 hash: Promise.resolve(old_new[1]),
//                                 p: p_p(),
//                             }
//                         }
//                     } else {

//                         log(`CACHE: creating promise for ${id.name} ${id.key}, not pure`)
//                         const pp = p_p()
//                         return {
//                             hash: hash_fun_strings(impl.pure ? d_hashes : [pp.then(hash_fun_result) , ...d_hashes]),
//                             p: pp,
//                         }
//                     }
//                 })()
//                 i.p    = p_and_hash.then((x) => x.p)
//                 i.hash = p_and_hash.then((x) => x.hash)
//                 i.valid = true
//             }
//             return cache[kk]
//         } else {
//             for (const v of d_res) {
//                 v.derived.push(id)
//             }

//             log(`CACHE: creating promise for ${id.name} ${id.key}, not in cache, time ${cache.time}`)
//             const pp = p_p()
//             cache[kk] = {
//                 p: pp,
//                 hash: hash_fun_strings(impl.pure ? d_hashes : [pp.then(hash_fun_result) , ...d_hashes]),
//                 dependencies,
//                 dependencyHashes: d_hashes,
//                 derived: [],
//                 valid: true,
//             }
//             return cache[kk]
//         }
//     }

//     return {
//         running_promises,
//         recurse_derived,
//         cache,
//         implementations,
//         get: (implementation: keyof Is) => (key: any) => {
//             return get_updated_cache_item({name: implementation as string, key})
//         },
//         invalidate,
//     }
// }

// export const new_cache_with_implemenation = (o: {file_watcher?: (path: string) => void}) => {
//     const cache = new_cache({
//         filetype: filetype(o.file_watcher),
//         file_as_string: file_as_string(o.file_watcher),
//         file_as_json,
//         transpiled,
//         file_analyzed,
//     })
//     return Object.assign(cache, {
//         invalidatePath: (path: string) => {
//             cache.invalidate({name: "file_as_string", key: path});
//             cache.invalidate({name: "filetype", key: path})
//         },
//     })
// }

// // export const invalidatePath = (cache: Cache, m: {invalidate: (id: string) => void}): invalidatePath  =>
// //     (path: string) => {
// //         m.invalidate(`file_type_a_h:    ${path}`)
// //         m.invalidate(`file-as-string:${path}`)
// //     }

// export const file_as_string: <K extends string>(watcher?: (path: K) => void) => CacheImplementation<K, string|undefined> = (watcher) => ({
//     watcher,
//     pure: false,
//     name: "file_as_string",
//     dependendencies: (k) => [],
//     promise: async (k, dependency_values) => {
//         log(`CACHE: file_as_string ${k}`)
//         try { return await readFile(k, "utf8"); } catch (e) { return undefined; } },
// })

// export const filetype: <K extends string>(watcher?: (path: K) => void) => CacheImplementation<K, string> = (watcher) => ({
//     watcher,
//     pure: false,
//     name: "filetype",
//     dependendencies: (k) => [],
//     promise: async (k, dependency_values) => {
//         force_absolute(k)
//         log(`CACHE: filetype ${k}`)
//         try {
//             const x = await stat(k)
//             if (x.isFile()) return "file"
//             if (x.isDirectory()) return "directory"
//         } catch (e) {
//         }
//         return     "failure_or_other";
//     },
// })

// export const file_analyzed: CacheImplementation<string, IFastAnalysis> = {
//     pure: true,
//     name: "file_as_string",
//     dependendencies: (k) => [{name: "file_as_string", key: k}],
//     promise: async (k, dependency_values) => fastAnalysis({ input: dependency_values[0] }),
// }

// export const transpiled: CacheImplementation<{moduleKind: ts.ModuleKind, path: string}, TranspileOutput > = {
//     pure: true,
//     name: "transpiled",
//     dependendencies: (k) => [{name: "file_as_string", key: k.path}],
//     promise: async (k, dependency_values) => {
//         if (dependency_values[0] === undefined)
//         throw new Error(`cannot transpile ${k.path} because file_as_string yields undefined`)
//         return ts.transpileModule(dependency_values[0] as string, { compilerOptions: { module: k.moduleKind } })
//     },
// }

// export const file_as_json: CacheImplementation<string, any | undefined > = {
//   pure: true,
//   name: "transpiled",
//   dependendencies: (k) => [{name: "file_as_string", key: k}],
//   promise: async (k, dependency_values) => dependency_values[0] === undefined ? undefined : JSON5.parse(dependency_values[0]),
// }
