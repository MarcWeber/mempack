// import {any, Promise} from "bluebird"

/*
  Cache:
  - same input yields same output
  - know when to drop cached shared results

  files as input get hashed by their contents to record 'snapshot'
*/

import * as bluebird from "bluebird"
import deepequal from "deep-equal"
import fs from "fs"
import { fastAnalysis, IFastAnalysis } from "fuse-box/analysis/fastAnalysis";
import JSON5 from "json5"
import ts from "typescript"
import { promisify } from "util"
// import weak from "weak"
const weak: { get: <T>(x: T) => T}  & (<T extends object>(t: T, cb: (t: T) => void) => T) = (() => {
    const x = <T>(x: T): T => x
    x.get = <T>(x: T): T => x
    return x
})()
import { log } from "./log";
import { force_absolute, strcmp, throw_, xx } from "./Util";
// hash identifier
export type CacheId = string

export type HashCacheResult<T> = Promise<{
    hash: string, // hash not depending on dependencies, only on the result
    item: T,
}>

// instance used by user. Once user releases this cache items might be freed
export type CacheRoots < CF > = ({
    roots: {[key: string]: undefined}, // should not be collected
    // get: <B extends true | undefined>(hash: string, allowUndefined?: B) => B extends true ? (HashCacheResult<any> | undefined): HashCacheResult<any>,
    get: (hash: string) => HashCacheResult < any > ,
    getMaybe: (hash: string) => HashCacheResult<any> | undefined,
    set: (hash: string, contents: HashCacheResult<any>) => void,
} & {[K in keyof CF]: CF[K] extends (x: CacheRoots<any>) => infer R ? R : never })

interface CacheItem<T> {
    timestamp: number,
    item: HashCacheResult<T>
}

export interface HashedCache<CF> {
    cacheRootsObject: () => CacheRoots<CF>,
    cache: {[key: string]: CacheItem<any>},
    cacheRootsObjects: Set<CacheRoots<any>> ,  // should be WeakRefs .. is there already an implementation which works?
                                   // then release could be made obsolete
    gc: () => void,
 }

export const newGlobalHashedCache = <CF>(cacheFunctions: CF): HashedCache<CF> => {
    const users: HashedCache<CF>["cacheRootsObjects"] = new Set()
    const cache: HashedCache<CF>["cache"] = {}
    const timestamp = () => new Date().getTime()
    const add = (hash: string, item: HashCacheResult<any>) => {
        cache[hash] = {
            timestamp: timestamp(),
            item,
        }
    }
    const gc = () => {
            // delete everything which is no longer used
            const roots = Object.assign({}, ...Array.from(users).map((x) => {const got = weak.get(x); return got || {}}))
            const t = timestamp()
            for (const [k, v] of Object.entries(cache)) {
                if (!(k in roots) && v.timestamp + 30 < t) {
                    delete cache[k]
                }
            }
        }
    return {
        cacheRootsObjects: users,
        cacheRootsObject: () => {
            const roots: {[key: string]: undefined} = {}
            const user: CacheRoots<any> = {
                set: async (hash, contents) => {
                    roots[hash] = undefined
                    add(hash, contents)
                },
                roots,
                getMaybe: (hash) => cache[hash] && cache[hash].item,
                get: (hash) => hash in cache ? cache[hash].item : throw_(`couldn't find hash ${hash}`),
            }
            for (const [k, v] of Object.entries(cacheFunctions)) {
                user[k] = v(user)
            }
            users.add(weak(user, () => { log("GCing user HashedCashed user object") ; gc()}) as CacheRoots<CF>)
            return user as CacheRoots<CF>;
        },
        cache,
        gc,
    }
}

export const cache_method =
    <I extends string |object, O extends string|object>
    (opts: { gen: (cR: CacheRoots<any>, i: I) => Promise<O>, hashinput?: (i: I) => string, hashresult?: (o: O) => string}) => (cacheRoot: CacheRoots<any>) => (i: I): HashCacheResult<O> => {
    const hashI = (opts.hashinput || xx) (i)
    const r = cacheRoot.getMaybe(hashI)
    if (r !== undefined) return r
    const p = opts.gen(cacheRoot, i)
    const r2: HashCacheResult<O> = p.then((x) => {
        return {
        item: x,
        hash: (opts.hashresult || xx)(x),
        }
    })
    cacheRoot.set(hashI, r2)
    return r2
}

export const file_analyzed = cache_method({
    gen: (cr, hashId: CacheId) => cr.get(hashId).then((i) => fastAnalysis({ input: i.item})),
})

export const file_transpiled = cache_method({
    gen: (cr, input: {moduleKind: ts.ModuleKind, cacheIdOfPath: CacheId}) => cr.get(input.cacheIdOfPath).then((i) => ts.transpileModule(i.item, { compilerOptions: { module: input.moduleKind } })),
})

export const file_as_json = cache_method({
    gen: (cr, cacheIdOfPath: CacheId) => cr.get(cacheIdOfPath).then((i) => JSON5.parse(i.item)),
})
