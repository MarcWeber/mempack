import { newGlobalState } from "../../src/GlobalState";
import * as Mempack from "../../src/Mempack"
import {method} from "./method"
import {ABC} from "./class"

console.log(Object.keys(require.cache))

const globalState = newGlobalState({watch: true})

Mempack.node_hmr(globalState,
  Mempack.resolveContext(() => {
      return {
        // path ?: string, // all paths will be taken relative to this one
        node_modules: ["../../node_modules"],
        entryPoints: [process.argv[1]],
        tsconfig: "../../tsconfig.json",
        target: "node",
        // path?: string
        // config: ts.CompilerOptions,
      };
    }),
)

let timer;

const instance = new ABC()

const worker = () => {
    method()
    instance.print()
    timer = setTimeout(worker, 1000)
}
if (!timer) worker();

process.on("unhandledRejection", (error, p) => {
  console.log("=== UNHANDLED REJECTION ===", error);
  // @ts-ignore
  console.dir(error.trace);
});
