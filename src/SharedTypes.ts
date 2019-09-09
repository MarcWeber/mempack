export interface Module {
    hash: string, // hash on this file
    hashDependencies?: string, // hash over hashes of dependencies
    path: string,
    dependency_mappings: {[key: string]: string} // if path cannot be resolved set path here
}
export interface Package {
    modules: {[key: string]: Module },
}
