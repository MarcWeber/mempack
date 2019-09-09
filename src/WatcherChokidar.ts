import * as chokidar from "chokidar"
import { FSWatcher } from "fs"

/* TODO there is some problem maybe with absolute paths - eg samples/ * /method.ts */

interface Watched { [key: string]: number }

const watch = (watched: Watched, thing: string, f: () => void) => {
    if (!(thing in watched)) {
        watched[thing] = 0
    } else {
        watched[thing] += 1
    }
    if (watched[thing] === 1)
        f()
}

const unwatch = (watched: Watched, thing: string, f: () => void) => {
    if (thing in watched) {
        watched[thing] -= 1
        if (watched[thing] === 0)
            f()
    }
}

// for now keeping it simple: Each watcher has its own chokidar instance.
// maybe can be shared / optimized later
export class Watcher {
    public watched: Watched
    public chokidar: FSWatcher
    public watchers: Array<(a: any, b: string) => void>

    constructor(public globalWacher: GlobalWatcher) {
        this.watched = {}
        this.watchers = []
        this.chokidar = chokidar.watch([], {alwaysStat: true})
        this.chokidar.on("all", (...args) => {
            for (const v of this.watchers) {
                // @ts-ignore
                v(...args)
            }
        })
    }
    public watch(thing: string) {
        watch(this.watched, thing, () => {
            console.log("WATCHING ", thing)
            // @ts-ignore
            this.chokidar.add(thing)
        })
    }
    public unwatch(thing: string) {
        unwatch(this.watched, thing, () => {
            console.log("UNWATCHING ", thing)
            // @ts-ignore
            this.chokidar.unwatch(thing)
        })
    }

    public close() {
        console.log("WATCH CLOS")
        this.chokidar.close()
        this.globalWacher.removeWatcher(this)
    }
}

export class GlobalWatcher {

    public watched: { [key: string]: number } = {}

    public watchers: Watcher[] = []

    constructor() {
    }

    public new_watcher(): Watcher {
        const w = new Watcher(this)
        this.watchers.push(w)
        return w
    }

    public removeWatcher(w: Watcher) {
        this.watchers = this.watchers.filter((x) => x !== w)
    }

}
