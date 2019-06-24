import fs from 'fs'
import { IFastAnalysis, fastAnalysis } from 'fuse-box/analysis/fastAnalysis';
import { textChangeRangeIsUnchanged, TranspileOutput } from 'typescript';
import ts from 'typescript'
import JSON5 from 'json5'
import deepequal from 'deep-equal'
import { run_tests_with_dependencies } from 'ttslib/TestRunnerWithDependencies';
import { promisify } from 'util'
import xx from 'xxhashjs'
import { dependencyTree } from './dependencies';

const readFile = promisify(fs.readFile)
const stat = promisify(fs.stat)

/* smart cache
  derived contents are linked to source. Even if chokidar says 'file changed' because :w! 
  the eql comparison will catch it and not destroy derived contents unless file contents changed
*/

export type Hashed<T> = {
    hash: string,
    value: T
}

// adding async functions would be possible, but would make it become much more complicated
export type CacheResult<T> = {
    value: T,
    hash?: Promise<string>,
    id: string,
    derived: string[],
    dependencies: string[],
    valid: 
      true  
    | false // must be revalidated, eg dependencies might have changed
}

export type AsyncCacheResult<T> = CacheResult<Promise<T>>

export type Cache = {
    running_promises: Set<Promise<any>>,
    cache: {[key:string]: CacheResult<any>}
}

export const new_cache: () => Cache = () => ({
    running_promises: new Set(),
    cache: {}
})
export type get = <T>(id: string, f: () => T, opts:{derived?: string[], dependencies?: CacheResult<any>[], eql?: (a:T, b:T) => boolean}) => CacheResult<T>
export type get_async = <T>(id: string, f: () => Promise<T>, opts:{derived?: string[], dependencies?: CacheResult<any>[], eql?: (a:T, b:T) => boolean}) => AsyncCacheResult<T>
export type invalidate = (id:string) => void
export type remove = (id:string) => void

export type M = {
    get: get,
    invalidate: invalidate,
    remove: remove
}

// export const get = (cache:Cache, m:M): get =>
//         <T>(id: string, f: () => T, opts:{derived?: string[], dependencies?: CacheResult<any>[], eql?: (a:T, b:T) => boolean}): CacheResult<T> => {
//             const in_cache = id in cache
//             if (!in_cache || !(cache.cache[id].valid)) {
//                 const value = f()
//                 if (in_cache){
//                     if ((opts.eql || deepequal)(value, cache.cache[id].value)) {
//                         cache.cache[id].valid = true;
//                     } else
//                         m.remove(id)
//                 }
//                 if (!(id in cache) || !cache.cache[id].valid) {
//                     for (const v of opts.dependencies || []) {
//                         v.derived.push(id)
//                     }
//                     cache.cache[id] = { id, valid: true, derived: opts.derived || [], dependencies: (opts.dependencies || []).map((x) => x.id), value }
//                 }
//             }
//             return cache.cache[id]
//         }


export const get_async = (cache:Cache, m:M): get_async => <T>(id: string, f: () => Promise<T>, opts:{derived?: string[], dependencies?: CacheResult<any>[], eql?: (a:T, b:T) => boolean}): AsyncCacheResult<T> => {
    const in_cache = id in cache

    const sorted_dependencies = () => {
        const l =(opts.dependencies || []).map((x) => x.id)
        l.sort()
        return l
    }

    if (!in_cache) {
        const p = f()
        cache.running_promises.add(p)
        p.finally(() => cache.running_promises.delete(p))
        const r = { id, valid: true, derived: opts.derived || [], dependencies: sorted_dependencies(), value: p }
        r.dependencies.sort()
        cache.cache[id] = r
        return r
    }

    // in cache, check validity
    const r = cache.cache[id]

    // dependencies should be same
    const sd = sorted_dependencies()
    if (!deepequal(sd, r.dependencies))
        throw `dependencies missmatch ? expected ${r.dependencies.join(',')}  ${sd.join(',')}`

    if (r.valid) return r
    return cache.cache[id]
}

export const recurse_dependencies = (cache:Cache, id:string, f: (id:string, cr: CacheResult<any>) => void) => {
    const cr = cache.cache[id]
    cr.derived.forEach((id) => recurse_dependencies(cache, id, f))
    f(id, cr)
}

export const invalidate = <M>(cache:Cache): invalidate  =>
    (id: string) => {
        recurse_dependencies(cache, id, (i, cr) => { cr.valid = false; })
    }

export const remove = <M extends { invalidate: invalidate }>(cache: Cache, m: M): remove =>
    (id: string) => {
        recurse_dependencies(cache, id, (i, cr) => { delete cache.cache[i]; } )
    }

export const initCache = (cache:Cache, m:any) => {
  // m.get   = get(cache)
  m.get_async = get_async(cache, m)
  m.remove = remove(cache, m)
  m.invalidate = invalidate(cache)
}

export const initCache2: (cache: Cache, opts: { watcher?: (file: string) => void }) => M & {
    get_async: get_async,
    file_as_string_a_h: file_as_string_a_h,
    file_as_json_a_h: file_as_json_a_h,
    file_analysed_a_h: file_analysed_a_h,
    file_transpiled_a_h: file_transpiled_a_h,
    file_type_a_h: file_type_a_h,
    file_xxhash_a_h: file_xxhash_a_h,
} = (cache: Cache, opts = {}) => {
    // @ts-ignore
    const m: ReturnType<typeof initCache2> = {}
    initCache(cache, m)
    const fas = file_as_string_a_h(m)
    m.file_as_string_a_h = fas
    m.file_as_string_a_h = (path: string) => {
        if ('watcher' in opts && opts.watcher) opts.watcher(path)
        return fas(path)
    }
    m.file_analysed_a_h = file_analysed_a_h(m)
    m.file_transpiled_a_h = file_transpiled_a_h(m)
    m.file_as_json_a_h = file_as_json_a_h(m)
    m.file_type_a_h = file_type_a_h(m)
    m.file_xxhash_a_h = file_xxhash_a_h(m) // this hashing could be incredible fast, thus maybe its even better to make it part of file_as_string ?
    return m;
}

export type file_as_string_a_h = (path:string) => AsyncCacheResult<Hashed<string>>
export const file_as_string_a_h: (m:{get_async: get_async}) => file_as_string_a_h = (m) => (path) => {
    const id = `file-as-string:${path}`
    return m.get_async(id, async () => {
        const [contents, stats] = await Promise.all([readFile(path, "utf8"), stat(path)])
        return {
            hash: (stats as fs.Stats).mtime.toString(),
            value: contents,
        }
    } , {}) }

/*
export type file_as_string = (path:string) => CacheResult<string>
export const file_as_string: (m:{get: get}) => file_as_string = (m) => (path) => {
    const id = `file-as-string:${path}`
    return m.get(id, () => fs.readFileSync(path, 'utf8'), {})
}
*/

export type file_analysed_a_h = (path:string) => AsyncCacheResult<Hashed<IFastAnalysis>>
export const file_analysed_a_h: (m: {file_as_string_a_h: file_as_string_a_h, get_async: get_async}) => file_analysed_a_h = (m)  => (path) => {
    const id = `fa:${path}`
    const file = m.file_as_string_a_h(path)
    return m.get_async(id, () => file.value.then(file => ({hash: file.hash, value: fastAnalysis({ input: file.value })})), {derived: [id], dependencies: [file]} )
}

export type file_transpiled_a_h = (moduleKind: ts.ModuleKind, path: string) => AsyncCacheResult<Hashed<TranspileOutput>>
export const file_transpiled_a_h: (m:{file_as_string_a_h:file_as_string_a_h, get_async:get_async}) => file_transpiled_a_h  = (m) => (moduleKind: ts.ModuleKind, path: string) => {
    const id = `transpile-to-${moduleKind}:${path}`
    const file = m.file_as_string_a_h(path)
    return m.get_async(id, () => file.value.then((file) => {
        console.log(`transpiling ${path} with kind ${moduleKind}`)
        return {hash: file.hash, value: ts.transpileModule(file.value, { compilerOptions: { module: moduleKind } })};
    }), {derived: [id], dependencies: [file]})

}

export type file_as_json_a_h = (path:string) => AsyncCacheResult<Hashed<any>>
export const file_as_json_a_h: (m:{file_as_string_a_h: file_as_string_a_h, get_async:get_async}) => file_as_json_a_h = m => (path) => {
    const id = `file-as-json:${path}`
    const file = m.file_as_string_a_h(path)
    // or use require !
    return m.get_async(id, () => file.value.then(file => ({hash: file.hash, value: JSON5.parse(file.value)})), {derived: [id], dependencies: [file]})
}

export type file_type_a_h = (path:string) => AsyncCacheResult<"file"|"directory"|"failure_or_other">
export const file_type_a_h: (m:{get_async:get_async}) => file_type_a_h = m => (path) => {
    const id = `file_type_a_h:${path}`
    return m.get_async(id, async () => {
      try {
        const x = await stat(path)
        if (x.isFile()) return "file"
        if (x.isDirectory()) return "directory"
      } catch (e) {
      }
      return "failure_or_other";
    } , {derived: [id], dependencies: []})
}

export type file_xxhash_a_h = (path:string) => AsyncCacheResult<string>
export const file_xxhash_a_h: (m:{file_as_string_a_h: file_as_string_a_h, get_async:get_async}) => file_xxhash_a_h = m => (path) => {
    const id = `xxhash:${path}`
    const file = m.file_as_string_a_h(path)
    return m.get_async(id, () => file.value.then((f) => xx.h32(f.value, 0xABCD).toString(16)), {derived: [id], dependencies: [file]})
}