import fs from 'fs'
import { IFastAnalysis, fastAnalysis } from 'fuse-box/analysis/fastAnalysis';
import { textChangeRangeIsUnchanged, TranspileOutput } from 'typescript';
import ts from 'typescript'
import JSON5 from 'json5'
import deepequal from 'deep-equal'

// same as Cache, because there is no 'update' we don't have to track dependencies

export type Hashed<T> = {
    hash: string,
    value: T
}

export type Cache<C> = {
    running_promises: Set<Promise<any>>,
    cache: {[key:string]: any}
} & C

export const new_cache : () => Cache<{}> = () => ({
    running_promises: new Set(),
    cache: {}
})
export type get = <T>(id: string, f: () => T, opts:{derived?: string[], dependencies?: [], eql?: (a:T, b:T) => boolean}) => T
export type get_async = <T>(id: string, f: () => Promise<T>) => Promise<T>
export type invalidate = (id:string) => void
export type remove = (id:string) => void

export type M = {
    get: get,
    invalidate: invalidate,
    remove: remove
}

// get
export const get = <M>(cache:Cache<{}>): get =>
        <T>(id: string, f: () => T): T => {
            const in_cache = id in cache
            if (!(id in cache)){
                cache[id] = f()
            }
            return cache[id]
        }

export const get_async = (cache:Cache<{}>): get_async =>
        <T>(id: string, f: () => Promise<T>): Promise<T> => {
            if (!(id in cache)){
                const p = f()
                cache[id] = p
                cache.running_promises.add(p)
                p.finally(() => cache.running_promises.delete(p))
            }
            return cache[id] as Promise<T>
        }

export const initCache = (cache:Cache<{}>, m:any) => {
  m.get   = get(cache)
  m.get_async   = get_async(cache)
}