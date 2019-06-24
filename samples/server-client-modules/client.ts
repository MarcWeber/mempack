import * as CL from "./client-lib"

let timer;

const worker = () => {
    CL.log()
    timer = setTimeout(worker, 1000)
}
if (!timer) worker();
