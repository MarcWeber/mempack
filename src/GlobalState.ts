import * as Bluebird from "bluebird"
import chalk from "chalk";
import express from "express";
import * as fs from "fs";
import JSON5 from "json5";
import path from "path";
import { async_singleton } from "ttslib/U";
import ts, { createTextChangeRange } from "typescript";
import * as _ from "underscore"
import { promisify } from "util";
import * as Cache from "./Cache";
import { Context, defaultResolveImplementation, dependencyTree, File, GCTX, Target } from "./dependencies";
import { p } from "./dummy";
import { createHMRServer } from "./hmrServer";
import * as Watcher from "./WatcherSane"

export interface GlobalState<C> {
  cache: ReturnType<typeof Cache.new_cache_with_implemenation>, // newCache result
  watcher?: Watcher.Watcher,
  // newRun: (opts:{
  //   changed?: () => void
  // })
}

export const newGlobalState = (o: {watch?: boolean}): GlobalState<{}> => {
  const watcher = o.watch ? new Watcher.Watcher() : undefined
  const cache = Cache.new_cache_with_implemenation({ file_watcher: watcher ? (path: string) => { try {watcher.watch(path)} catch (e) {}} : undefined } );
  if (watcher)
    watcher.watchers.push((path: string) => {
      console.log("watched filechange", path)
      cache.invalidatePath(path)
    })
  return {
    watcher,
    cache,
  }
}
