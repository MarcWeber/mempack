import chalk from "chalk"
import fs from "fs"
import path from "path"
import xxhash from "xxhashjs"
import {isClass} from "ttslib/U"

export const strcmp = (a: string, b: string) => {
    return (a < b ? -1 : (a > b ? 1 : 0));
}

export const force_absolute = (path: string) => {
    // having canonical absolute (canonical) paths is important for invalidating cache
    if (path[0] !== "/" ) {
        throw new Error(`path ${path} is not absolute`)
    }
}

export const path_walk_till = (opts?: {
    pathsExists: string[],
}  ) => (po: string) => {
    if (!opts)
    opts = {pathsExists: [".svn", ".git", "node_modules", "src", "package.json", "tsmono.json"]}
    const ps = opts.pathsExists.map((x) => (p: string) => fs.existsSync(path.join(p, x)))
    let p = po
    while (!["/", "."].includes(p)) {
        if (ps.find((x) => x(p))) {
            return p
        }
        p = path.dirname(p)
    }
    throw new Error(`no basedir found for ${po}`)
}

export const node_hot_reload = (files: string[]) => {
    // I don't know what I am doing here but it works ..
    // There might be some side effects I haven'n investigated
    // but its for development only anyway and can save some time

    // allow to replace multiple modules for circular dependencies reasons
    // modules will be required in the order passed in files
    // cache and delete old modules
    const old_modules: {[key: string]: any} = {}

    // remove old modules, so that require will reload them, but keep reference so that functions items can be updated
    for (const v of files) { old_modules[v] = require.cache[v]; delete require.cache[v] }

    for (const v of files) {
        const new_module = require(v)
        let old_module = old_modules[v]
        require.cache[v].old_module = old_module // keep tree of old modules so that if it gets updated again the old modules can be updated, too
        while (old_module) {
            for (const [k, v] of Object.entries(new_module)) {
                console.log("overwriting ", k, old_module.exports[k], old_module.exports[k].prototype);
                if (isClass(v) && isClass(old_module.exports[k])){
                    // class case: keep old class but overwrite properties
                    console.log("class detected");
                    for (const k2 of Object.getOwnPropertyNames(v.prototype)){
                        old_module.exports[k].prototype[k2] = v.prototype[k2]
                    }
                }
                else {
                    // in the non class case just set new function
                    old_module.exports[k] = v
                }
            }
            old_module = old_module.old_module
        }
    }
}

export const notify_sync_process = (label: string, f: () => void) => {
        process.stdout.write(chalk.red(`${label} ..`))
        f()
        process.stdout.write(chalk.green(`done \n`))
}

export const xx = (s: string | object) => s === undefined ? "undefined" : xxhash.h32(typeof s === "string" ? s : JSON.stringify(s) , 0xABCD).toString()

export const throw_ = (msg: string) => { throw new Error(msg) }

export const cachedByKeyAsync = <R>(f: (k: string) => Promise<R>) => {
    const cache: {[key: string]: Promise<R>} = {}
    return (k: string) => {
        if (!(k in cache))
            cache[k] = f(k)
        return cache[k]
    }
}
