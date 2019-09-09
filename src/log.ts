export const log = (x: any) => process.env.DEBUG ? console.log("LOG:", typeof(x) === "function" ? x() : x) : undefined
