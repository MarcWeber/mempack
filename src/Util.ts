export const strcmp = (a: string, b: string) => {
    return (a < b ? -1 : (a > b ? 1 : 0));
}

export const force_absolute = (path: string) => {
    // having canonical absolute (canonical) paths is important for invalidating cache
    if (path[0] !== "/" ) {
        throw new Error(`path ${path} is not absolute`)
    }
}