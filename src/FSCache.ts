/*
Accessing the filesystem and reading the same files over and over again takes time.
Eg once you get to 2,000 only fstating the files takes most time.

So this module tries to cache the filesystem invalidating the cache on update changes.
*/

// import {any, Promise} from "bluebird"
import * as bluebird from "bluebird"
import { watch } from "chokidar";
import deepequal from "deep-equal"
import fs from "fs"
import { fastAnalysis, IFastAnalysis } from "fuse-box/analysis/fastAnalysis";
import JSON5 from "json5"
import { exception_to_str } from "ttslib/exception";
import { trace_args_on_exception } from "ttslib/trace";
import ts from "typescript"
import { isUndefined, promisify } from "util"
import { AbsolutePath } from "./dependencies";
import * as HC from "./HashedCache"
import { log } from "./log";
import { force_absolute, strcmp, xx } from "./Util";

const readFile = promisify(fs.readFile)
const stat = promisify(fs.stat)

export type FileTypeReturnType = "file" | "directory" | "failure_or_other"

export interface FSCache {
    // register file version in cr and return CacheId
    file_hash: (cr: HC.CacheRoots<any>) => (path: string) => Promise<undefined | {
        cacheId: HC.CacheId,
        item: string,
    }>
    filetype: (path: string ) => Promise<FileTypeReturnType>
}

export interface FileWatcher {
    watch: (path: string) => void,
    on_change: (f: ( path: string) => void) => void,
}

export const newFsCache = (fileWatcher?: FileWatcher): FSCache => {
    const file_hash_cache: {[key: string]: string} = {}
    const file_type_cache: {[key: string]: string} = {}
    if (fileWatcher)
        fileWatcher.on_change((path: string) => {
            delete file_hash_cache[path]
            delete file_type_cache[path]
        })
    const cached = <T>(cache: {[key: string]: any}, key: string, f: () => Promise<T>): Promise<T> => {
        if (key in cache) return cache[key]
        const p = f()
        cache[key] = p
        return p
    }
    const watch = !fileWatcher ? () => {} : (path: string) => {
            log(`FSCache watching ${path}`)
            fileWatcher.watch(path)
    }

    const filetype = async (path: string) => {
          force_absolute(path)
          watch(path)
          return cached(file_type_cache, path, async () => {
              log(`CACHE: filetype ${path}`)
              // tslint:disable-next-line: no-unnecessary-initializer
              let r: FileTypeReturnType|undefined = undefined
              try {
                  const x = await stat(path)
                  if (x.isFile()) r = "file"
                  if (x.isDirectory()) r = "directory"
                  if (x.isSymbolicLink()) throw new Error(`${path} is symbolic link`)
              } catch (e) {
                  log(`error accessing ${exception_to_str(e)}`)
              }
              if (r === undefined) r = "failure_or_other";
              file_type_cache[path] = r
              return r
          })
      }

    return {
        file_hash: (cr: HC.CacheRoots<any>) => async (path: string) => {
            force_absolute(path)
            watch(path)
            return cached(file_hash_cache, path, async () => {
                log(`CACHE: file_as_string ${path}`)
                try {
                    log(`reading file ${path}`)
                    const item = await readFile(path, "utf8")
                    const cacheId = xx(item)
                    const r = { item, cacheId }
                    cr.set(cacheId, Promise.resolve({item, hash: cacheId}))
                    return r
                } catch (e) {
                    return undefined
                }
            })
        },
        filetype,
    }
}
