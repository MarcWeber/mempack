// // import {any, Promise} from "bluebird"
// // not used

// /*
//   Cache:
//   - same input yields same output
//   - know when to drop cached shared results

//   files as input get hashed by their contents to record 'snapshot'
// */

// import * as bluebird from "bluebird"
// import deepequal from "deep-equal"
// import fs from "fs"
// import { fastAnalysis, IFastAnalysis } from "fuse-box/analysis/fastAnalysis";
// import JSON5 from "json5"
// import ts from "typescript"
// import { promisify } from "util"
// import { dependencyTree } from "./dependencies";
// import { log } from "./log";
// import { force_absolute, strcmp, throw_, xx } from "./Util";

// // hash identifier
// export type CacheId = string

// export type HashCacheResult<T> = Promise<{
//     resultHash: string, // hash not depending on dependencies, only on the result
//     item: T,
// } >

// // instance used by user. Once user releases this cache items might be freed
// export type CacheRoots < CF > = ({
//     roots: {[key: string]: undefined}, // should not be collected
//     // get: <B extends true | undefined>(hash: string, allowUndefined?: B) => B extends true ? (HashCacheResult<any> | undefined): HashCacheResult<any>,
//     get: (hash: string) => HashCacheResult < any > ,
//     getMaybe: (hash: string) => HashCacheResult<any> | undefined,
//     set: (hash: string, contents: HashCacheResult<any>) => void
//     release: () => void,
// } & {[K in keyof CF]: CF[K] extends (x: CacheRoots<any>) => infer R ? R : never })

// interface CacheItem<T> {
//     resultHash: Promise<string> | string,
//     timestamp: number,
// }

// export interface HashedCache<CF> {
//     user: () => CacheRoots<CF>,
//     cache: {[key: string]: CacheItem<any>},
//     results: {[key: string]: any}
//     users: Set<CacheRoots<any>>, // should be WeakRefs .. is there already an implementation which works?
//                             // then release could be made obsolete
//     gc: () => void,
// }

// export const newGlobalHashedCache = <CF>(cacheFunctions: CF): HashedCache<CF> => {
//     const users: Set<CacheRoots<any>> = new Set()
//     const cache: HashedCache<CF>["cache"] = {}
//     const results: HashedCache<CF>["results"] = {}
//     const timestamp = () => new Date().getTime()
//     const add = (hash: string, item: HashCacheResult<any>) => {
//         const result: CacheItem<any> =  {
//             timestamp: timestamp(),
//             resultHash: item.then((x) => {
//                 if (!(x.resultHash in results)) {
//                     results[x.resultHash] = x.item
//                 }
//                 result.resultHash = x.resultHash
//                 return x.resultHash
//             }),
//         }
//         cache[hash] = result
//         return {
//         users,
//         user: () => {
//             const roots: {[key: string]: undefined} = {}
//             const getMaybe = async (hash: CacheId) => {
//                 const i = cache[hash]
//                 if (!i) return undefined
//                 if (typeof i.resultHash === "string")
//                     return results[i.resultHash]
//                 return i.resultHash.then((x) => results[x])
//             }
//             const user: CacheRoots<any> = {
//                 set: async (hash, contents) => {
//                     roots[hash] = undefined
//                     add(hash, contents)
//                 },
//                 roots,
//                 getMaybe,
//                 get: (hash) => getMaybe(hash).then((x) => {
//                     if (x === undefined) throw new Error(`hash ${hash} not found `)
//                     return x
//                 } ),
//                 release: () => {
//                     users.delete(user)
//                 },
//             }
//             for (const [k, v] of Object.entries(cacheFunctions)) {
//                 user[k] = v(user)
//             }
//             users.add(user)
//             return user as CacheRoots<CF>;
//         },
//         cache,
//         results,
//         gc: () => {
//             // delete everything which is no longer used
//             const roots = Object.assign({}, ...Array.from(users).map((x) => x.roots))
//             const t = timestamp()
//             const result_hashes: {[key: string]: undefined} = {}
//             for (const [k, v] of Object.entries(cache)) {
//                 if (!(k in roots) && v.timestamp + 30 < t) {
//                     delete cache[k]
//                     continue;
//                 }
//                 if (typeof v.resultHash === "string")
//                     result_hashes[v.resultHash] = undefined
//             }
//             // tidy up unreachable results
//             for (const v in results) {
//                 if (!(v in result_hashes))
//                     delete results[v]
//             }
//         },
//     }
// }

//     export const cache_method =
//     <I extends string |object, O extends string|object>
//     (opts: { gen: (cR: CacheRoots<any>, i: I) => Promise<O>, hashinput?: (i: I) => string, hashresult?: (o: O) => string}) => (cacheRoot: CacheRoots<any>) => (i: I): HashCacheResult<O> => {
//     const hashI = (opts.hashinput || xx) (i)
//     const r = cacheRoot.getMaybe(hashI)
//     if (r !== undefined) return r
//     const p = opts.gen(cacheRoot, i)
//     const r2: HashCacheResult<O> = p.then(l1)
//         item: p,
//         hash: p.then((x) => (opts.hashresult || xx)(x)),
//     }
//     cacheRoot.set(hashI, r2)
//     return r2
// }

//     export const file_analyzed = cache_method({
//     gen: (cr, hashId: CacheId) => cr.get(hashId).item.then((i) => fastAnalysis({ input:  i})),
// })

//     export const file_transpiled = (cr: CacheRoots<any>) => cache_method({
//     gen: (cr, i: {moduleKind: ts.ModuleKind, cacheIdOfPath: CacheId}) => cr.get(i.cacheIdOfPath).item.then((i) => ts.transpileModule(i, { compilerOptions: { module: i.moduleKind } })),
// })

//     export const file_as_json = (cr: CacheRoots<any>) => cache_method({
//     gen: (cr, cacheIdOfPath: CacheId) => cr.get(cacheIdOfPath).item.then((i) => JSON5.parse(i)),
// })
