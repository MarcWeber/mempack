import * as fs from "fs"
import * as path from "path"
import sane from "sane"
import { textSpanContainsPosition } from "typescript";
import { force_absolute } from "./Util";

/*
using $HOME will cause 50% CPU utilization on my machine
thus sane(base) base must be close to watched files
maybe using the 'project' directories (eg containing node_modules)
or just parent direcotry is the way to go ..
*/

interface Watched { [key: string]: number }

const watch = (watched: Watched, thing: string, f: () => void) => {
    if (!(thing in watched)) {
        watched[thing] = 0
    }
    watched[thing] += 1
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

// watching each directory cannot be done, because its too slow.
// thus find sane base diretories eg containing node_modules .. to watch
// this only has to be good enough ..
// TODO: simplify, no caching required
const sane_base_dir = () => {
    const exists_cache: {[key: string]: boolean} = {}
    const existsSync = (p: string) => {
        if (!(p in exists_cache)) exists_cache[p] = fs.existsSync(p)
        return exists_cache[p]
    }
    const contains = (file: string) => (dir: string) => (existsSync(path.join(dir, file)))
    const basedirs: string[] = []

    const basedir_indicators = [".svn", ".git", "node_modules", "src", "package.json", "tsmono.json"].map((x) => contains(x))
    return (po: string): string => {
        let p = po
        const found = basedirs.find((x) => p.startsWith(x))
        if (found) return found; // if we already are watching a basedir .. use that
        while (!["/", "."].includes(p)) {
            if (basedir_indicators.find((x) => x(p))) {
                basedirs.push(p)
                return p
            }
            p = path.dirname(p)
        }
        throw new Error(`no basedir found for ${po}`)
    }
}

const basedirs = <Thing extends string, PerBasedir>(opts: {
    new_per_basedir: (path: string) => PerBasedir,
    add_thing_to_basedir: (t: Thing, p: PerBasedir) => void,
    remove_thing_from_basedir: (t: Thing, p: PerBasedir) => boolean, // return true to cause removal of this basedir
    transfer_to_new_basedir: (source: PerBasedir, target: PerBasedir) => void,
    destroy_per_basedir: (path: string, p: PerBasedir) => void,
    basedir: (t: Thing) => string,
}) => {

    const by_basedir: { [key: string]: PerBasedir } = {}

    return {
        remove: (path: Thing) => {
            const basedir = Object.keys(by_basedir).find((x) => path.startsWith(x))
            if (!basedir) throw new Error(`${path} cannot be removed because it probably was never added or bug`)
            if (opts.remove_thing_from_basedir(path, by_basedir[basedir]))
                opts.destroy_per_basedir(basedir, by_basedir[basedir])
        },
        add : (path: Thing) => {
            force_absolute(path)
            console.log("basedirs watched", Object.keys(by_basedir))
            const basedir = Object.keys(by_basedir).find((x) => path.startsWith(x))
            if (basedir) {
                opts.add_thing_to_basedir(path, by_basedir[basedir])
                return
            }
            const new_basedir = opts.basedir(path)
            by_basedir[new_basedir] = opts.new_per_basedir(new_basedir)
            opts.add_thing_to_basedir(path, by_basedir[new_basedir])
            for (const obsolete of Object.keys(by_basedir).filter((x) => x.startsWith(new_basedir))) {
                if (obsolete === new_basedir) continue;
                opts.transfer_to_new_basedir(by_basedir[obsolete], by_basedir[new_basedir])
                opts.destroy_per_basedir(obsolete, by_basedir[obsolete])
            }
        },
        destroy: () => {
            for (const obsolete of Object.keys(by_basedir)) {
                opts.destroy_per_basedir(obsolete, by_basedir[obsolete])
            }
        }
,    }
}

// for now keeping it simple: Each watcher has its own chokidar instance.
// maybe can be shared / optimized later
export class Watcher {
    public by_basedir: ReturnType<typeof basedirs>

    public watched: Watched // TODO: maybe can be remvoed because by_basedir is counting, too. But that could be slower due to finding baseddir, iteration should be fast
    public watchers: Array < (a: any, b: string) =>  void >

    constructor(public globalWacher ?: GlobalWatcher) {
        this.watched = {}
        this.watchers = []
        // watcher.on("ready", () => { console.log("ready") });

        this.by_basedir = basedirs<string, {
            watched_paths: {[key: string]: number},
            sane: sane.Watcher,
        }>({
            new_per_basedir: (basedir: string) => {
                const s = sane(basedir, { glob: ["ts", "js", "tsx", "jsx", "json"].map((x) => `**/*.${x}`) })
                const watched_paths = {}

                const changed = (type: string, thing: string) => {
                    const a = path.join(basedir, thing)
                    if (a in watched_paths)
                        this.watchers.forEach((x) => x(a, type))
                }
                s.on("change", (filepath: any, root: any, stat: any) => { changed("change", filepath) });
                s.on("add", (filepath: any, root: any, stat: any) => { changed("add", filepath) });
                s.on("delete", (filepath: any, root: any) => { changed("delete", filepath) });
                return {
                    sane: s,
                    watched_paths,
                }
            },
            add_thing_to_basedir: (t: string, p) => {
                if (!(t in p.watched_paths))
                    p.watched_paths[t] = 0
                p.watched_paths[t] += 1
            },
            remove_thing_from_basedir: (t, p) => {
                if (!(t in p.watched_paths)) throw new Error(`${t} cannot be removed because it probably was never added or bug`)
                p.watched_paths[t] -= 1
                if (0 === p.watched_paths[t])
                    delete p.watched_paths[t]
                return Object.keys(p.watched_paths).length === 0
            },
            transfer_to_new_basedir: (source, target) => {
                for (const [k, v] of Object.entries(source.watched_paths)) {
                    if (!(k in target.watched_paths))
                        target.watched_paths[k] = 0
                    target.watched_paths[k] += 1

                }
            },
            destroy_per_basedir: (path, p) => {
                p.sane.close()
            },
            basedir: sane_base_dir(),
        })
        this.watchers = []
    }
    public watch(thing: string) {
        watch(this.watched, thing, () => {
            console.log("WATCH WatcherSane", thing)
            this.by_basedir.add(thing)
        })
    }
    public unwatch(thing: string) {
        unwatch(this.watched, thing, () => {
            this.by_basedir.remove(thing)
        })
    }

    public close() {
        this.by_basedir.destroy()
        console.log("WATCH CLOS")
        this.watched = {}
        if (this.globalWacher) this.globalWacher.removeWatcher(this)
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
