import * as Bluebird from "bluebird"

export const p = () => new Bluebird.Promise((r, j, c) =>
r("abc"),
// setTimeout(() => r("abc"), 1000),
)
