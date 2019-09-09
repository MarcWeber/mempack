import * as CL from "./client-lib"
import {log} from "./client-lib"

let timer;

export const e = "export"

const worker = () => {
    CL.log()
    log()
    timer = setTimeout(worker, 1000)
}
if (!timer) worker();

console.log(require)

// change this text or the text of imported modules to test reloading
console.log('loading client.ts done');
