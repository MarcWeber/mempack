import _ from "underscore";
import { AbsolutePath, Dependencies, Hash } from "./dependencies";
import { log } from "./log";
import { xx } from "./Util";

/*
Goal give each file a hash to understand whether it changed or not.
If it changed it must be reloaded or sent to browser ..

Creating hash over dependencies is simple, but files can depend on each other, forming circular depnedencies.

Example:

    0 -> 4 (big outer circle, references 4)
    |
    1
    |
    2 -> A -> 3 (small sub circle)
    |
    3
    |
    4
    |
    5 ( does depend on circle)

    So the hash of a file should represent its behavior.
    Thus
    - hash of its own contents
    - circle it belongs to

    Hash of a circle is hash started be alphabetically lowest hash of file contents, then following dependencies
    dependency means 1) hash of file 2) hashes of dependencies which do not belong to circle ..

*/

interface Node {
    paths: AbsolutePath[],
    hashFile: Hash,
    hashBehavior: Hash
    dependenciesBehavioralHashes: Hash[]
}

interface NodeToHash {
}

interface CirclicStateNode {
    path: AbsolutePath,
    fileHash: Hash,
    nonCirclicDepsBehavorialHashes: Hash[],
    circlicChildrenFilePaths: AbsolutePath[],
}

interface CircleState {
    // while returning from recursively walking the tree
    // build up graph of circlid references to calculate hash
    // key is AbsolutePath
    state: {[key: string]: CirclicStateNode }
}

interface WalkResultC {
        // while walking up dependecnies a cyclce was found
        // hashing can only take place after cycle is complete,
        // because behavior depends on cylcle, thus return the nodes
        // whos has only can be calculated after cycle(s) are complete
        circles: AbsolutePath[], // paths
        path: string,
    }

type WalkResult =
    { behavorialHash: string } // DAG -> simple
    | WalkResultC

export interface  NormalizedDependencyResult {
    entryPoints: string[],
    nodesByBehavioralHash: { [key: string]: Node },
    pathToBehavioralHash: { [key: string]: Hash },
    missingDependencies: string[],
}

export const normalizedDependencyResultToStr = (r: NormalizedDependencyResult) => {
    const lines: string[] = []
    const seen: {[key: string]: undefined} = {}
    const todo: string[] = r.entryPoints.map((x) => r.pathToBehavioralHash[x])
    while (true) {
        const hash = todo.shift()
        if (hash === undefined) break;
        if (hash in seen) continue;
        seen[hash] = undefined
        const node = r.nodesByBehavioralHash[hash]
        if (node === undefined) {
            lines.push("  node undefined ??") // should not happen
            continue;
        }
        lines.push(`${hash}, paths: ${node.paths.join(",")}`)
        for (const v of node.dependenciesBehavioralHashes) {
            lines.push(`depends on ${v}` )
            todo.push(v)
        }
    }
    for (const v of r.missingDependencies) {
        lines.push(`missing ${v}`)
    }
    return lines.join("\n")
}

// TODO: test cases
export const normalizedDependencies = (dependencies: Dependencies) => {
    // TODO: check fileHash only used in building hash
    const nodesByBehavioralHash: NormalizedDependencyResult["nodesByBehavioralHash"] = {};
    const pathToBehavioralHash: NormalizedDependencyResult["pathToBehavioralHash"] = {};  // maybe ony entry points are cached
    const addNode = (n: {
        path: AbsolutePath,
        hashFile: Hash,
        hashBehavior: Hash,
        dependenciesBehavioralHashes: Hash[],
    }) => {
        const e = nodesByBehavioralHash[n.hashBehavior]
        if (e !== undefined) {
            if (e.paths.includes(n.path)) return;
            else {
                e.paths.push(n.path)
                if (!_.isEqual(n.dependenciesBehavioralHashes, e.dependenciesBehavioralHashes))
                throw new Error("unexpected")
            }
        } else {
            nodesByBehavioralHash[n.hashBehavior] = {
                paths: [n.path],
                hashFile: n.hashFile,
                hashBehavior: n.hashBehavior,
                dependenciesBehavioralHashes: n.dependenciesBehavioralHashes,
            }
        }
        /*
        paths: AbsolutePath[],
        hashFile: Hash,
        hashBehavior: Hash
        dependenciesBehavioralHashes: Hash[]
        */
    }

    const normalizedDependencies = async (entryPoints: AbsolutePath[], opts: {ignoreMissingDeps?: boolean} = {}) => {

        const dependencyTree = await dependencies.resolveDependencies(entryPoints)

        log(`dependencyTree ${JSON.stringify(dependencyTree)}`)

        const missingDependencies: string[] = []

        const seen_paths: {[key: string]: WalkResult} = {}

        const walkTree = (path: AbsolutePath, circleState: CircleState, paths: string[]): WalkResult => {

            const walk =  (): WalkResult => {
                log(`walkTree path ${path}, paths ${paths.join(",")}`)
                const node = dependencyTree.tree[path]
                if (node === undefined) {
                    throw new Error(`${path} not in ${Object.keys(dependencyTree.tree).join(",")}`)
                }
                if ("error" in node) {
                    const e = `missing dependency 1 ${path}, reason ${node.error}`
                    if (opts.ignoreMissingDeps) {
                        missingDependencies.push(e)
                        return { behavorialHash: e };
                    }
                    throw new Error(e);
                }

                // in cache, use cache result
                if (node.path in pathToBehavioralHash) return { behavorialHash: pathToBehavioralHash[node.path] }

                // detect cycles
                if (paths.includes(node.path)) {
                    return {
                        circles: [node.path], // earlier pass is responsible for adding node.path to circleState
                        path: node.path,
                    }
                }

                const dependencies = node.resolved.map((n) => typeof n.node === "string" ? walkTree(n.node, circleState, [node.path, ...paths]) : n)
                const dependencies_filtered: WalkResult[] = []
                const circlicDependencies: WalkResultC[] = []
                const nonCirclicDependencies: WalkResult[] = []
                const nonCirclicDepsBehavorialHashes: string[] = []

                for (const d of dependencies) {
                    if ("node" in d) {
                        if (d.node === false) continue;
                        if (typeof d.node === "string") throw new Error("unexpected") // should not happen, because walkTree above got called
                        if ("error" in d.node) {
                            const short_msg = `path ${path} is missing dependency ${JSON.stringify(d.import)}, required by ${paths.join(",")}`
                            if (opts.ignoreMissingDeps) {
                                // d.node.error is very long
                                missingDependencies.push(short_msg)
                                continue;
                            } else {
                                throw new Error(`${short_msg} ${d.node.error}`);
                            }
                        }
                        continue;
                    }
                    dependencies_filtered.push(d)
                    if ("circles" in d) {
                        circlicDependencies.push(d)
                    }
                    if ("behavorialHash" in d) {
                        nonCirclicDependencies.push(d)
                        nonCirclicDepsBehavorialHashes.push(d.behavorialHash)
                    }
                }

                if (circlicDependencies.length > 0) {
                    // there are cyclic dependencies, therefore this is part of a cylce
                    // thus record dependencies in circleState so that hash can be calculated once circle is complete

                    if (node.path in circleState.state) throw new Error("unexpected")
                    circleState.state[node.path] = {
                        path: node.path,
                        fileHash: node.fileHash,
                        nonCirclicDepsBehavorialHashes,
                        circlicChildrenFilePaths: circlicDependencies.map((x) => x.path),
                    }
                    const remaining_circles = _.uniq(Array.prototype.concat.apply([], dependencies_filtered.map((x) => "circles" in x ? x.circles : []))).filter((x) => x !== node.path)

                    if (remaining_circles.length > 0) {
                        // continue passing unhashed nodes ..

                        return {
                            circles: remaining_circles,
                            path: node.path,
                        }
                    } else {
                        // stop all circles, calculate hashes ..

                        const lowestPath = Object.keys(circleState.state).sort()[0]

                        const walk = (f: (hash: string, n: CirclicStateNode) => void) => {
                            const seen: { [key: string]: undefined } = {}
                            const walk = (path: string) => {
                                if (path in seen) return
                                seen[path] = undefined
                                const n = circleState.state[path]
                                f(path, n)
                                n.circlicChildrenFilePaths.map(walk)
                            }
                            walk(lowestPath)
                        }

                        // calculate hash of circle
                        let hashes: string[] = []
                        walk((path, n) => {
                            hashes.push(n.fileHash)
                            hashes = [...hashes, ...n.nonCirclicDepsBehavorialHashes]
                        })
                        const circleHash = xx(hashes.join(":"))

                        // calculate hash of all files of circle
                        walk((path, n) => {
                            const behavorialHash: string = xx(n.fileHash + circleHash)
                            pathToBehavioralHash[n.path] = behavorialHash
                            addNode({
                                path: n.path,
                                hashFile: n.fileHash,
                                hashBehavior: behavorialHash,
                                dependenciesBehavioralHashes: [], // see below
                            })
                        })

                        // now that we have all hashes set, we can set dependencies ..

                        walk((path, n) => {
                            const behavorialHash = pathToBehavioralHash[n.path]
                            const e = nodesByBehavioralHash[behavorialHash]
                            e.dependenciesBehavioralHashes = n.circlicChildrenFilePaths.map((path) => pathToBehavioralHash[path])
                        })
                        // set
                        circleState.state = {}
                        return { behavorialHash: pathToBehavioralHash[node.path] }
                    }
                } else {
                    // no circle ..
                    // @ts-ignore
                    const behavorialHash: string = xx(node.fileHash + nonCirclicDepsBehavorialHashes.join(":"))
                    pathToBehavioralHash[node.path] = behavorialHash
                    addNode({
                        path: node.path,
                        hashFile: node.fileHash,
                        hashBehavior: behavorialHash,
                        dependenciesBehavioralHashes: nonCirclicDepsBehavorialHashes, // see below
                    })
                    return { behavorialHash }
                }
            }

            if (!(path in seen_paths)) {
                seen_paths[path] = walk()
            }
            return seen_paths[path]
        }
        entryPoints.map((ep) => walkTree(ep, {state: {}}, []))
        return {
            entryPoints,
            nodesByBehavioralHash,
            pathToBehavioralHash,
            missingDependencies,
        }
    }

    return {
        normalizedDependencies,
    }
}
