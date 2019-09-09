import { string } from "prop-types";
import ts from "typescript"
import _ from "underscore";

/* we want truly lazy code ..
thus replace

// lazy-modules foo,
const x  = require('foo')
x()

by
const x  = require('foo')
x()()  whele x() is loading the library in a strict way

For now using AMD like module format because it allows easy processing

Yes, this might suck, but might also allow to force best user experience
because you can run code while more code is loading,
maybe even changing prioriy on the fly using web sockets ?

*/

export const transpileLazy = (code: string, opts: {
    forceModuleToBeLazy?: (path: string) => boolean,
}) => {
    const ts_transpiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.AMD } })

    /* AMD like module
        define(["require", "exports", "./client-lib", "./client-lib"], function (require, exports, CL, client_lib_1) {
            "use strict";
            exports.__esModule = true;
            var timer;
            exports.e = "export";
            var worker = function () {
                CL.log();
                client_lib_1.log();
                timer = setTimeout(worker, 1000);
            };
            if (!timer)
                worker();
            console.log(require);
        });
      */

    let lazy_modules: string[] = []
    const lazy_modules_groups = code.match(/\/\/ mempack lazy-modules: (.*)/)

    if (lazy_modules_groups) {
        lazy_modules = lazy_modules_groups[1].split(/,[ ]/)
    }

    const func_args = ts_transpiled.outputText.match(/define\((\[[^\]]*\]), function \(([^)]*)/)
    if (!func_args) throw new Error(`regex didn't match code \n${ts_transpiled.outputText}`);
    const paths: string[] = JSON.parse(func_args[1])
    const vars = func_args[2].split(", ")

    if (paths[0] !== "require" || paths[1] !== "exports")
        throw new Error("first two items not require, exports")

    const all_modules: string[] = paths.slice(2)

    lazy_modules = _.intersection(all_modules, _.unique([...lazy_modules, ...opts.forceModuleToBeLazy ? paths.filter(opts.forceModuleToBeLazy) : []]))
    const code2 = ts_transpiled.outputText;

    const module_to_var = (path: string) => {
        const i = paths.indexOf(path)
        if (i === -1) throw new Error(`path ${path} not found in ${code}`)
        return vars[i]
    }

    const head_rest: string[] = code2.split("\n", 1)
    head_rest[1] = code2.slice(head_rest[0].length + 1)
    console.log("head_rest", head_rest)
    for (const v of lazy_modules) {
        // TODO: ensure its not replaced in strings ..
        const name = module_to_var(v)
        console.log("replacing", `\\b${name}\\b`, `${name}()`)
        head_rest[1] = head_rest[1].replace(new RegExp(`([^a-zA-Z_])${name}([^a-zA-Z_])`), `$1${name}()$2`)
    }

    return {
        diagnostics: ts_transpiled.diagnostics,
        sourceMapText: ts_transpiled.sourceMapText,
        outputText: head_rest[0] + "\n" + head_rest[1],
        lazy_modules,
        strict_modules: [],
        paths,
        vars,
    }
}
