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
