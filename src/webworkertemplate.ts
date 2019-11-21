//  see https://github.com/Microsoft/TypeScript/issues/11781
/// <reference types="types-serviceworker" />
/// <reference types="types-serviceworker/lib/workbox" />

// console.log("self", self)
// const cacheName = "cache";
// const p = ${JSON.stringify(prefetch)}
// if (localStorage.current_version != p.version)
// localStorage.current_version = p.version
// localStorage.to_be_fetched   = p.resources;
// // localStorage.fully_fetched   = p.resources;

type Request_ = any
type RequestResult_ = any

const myfetch = async (request: Request_): Promise < RequestResult_ > => {
    return {};
}

self.addEventListener("install", (e) => {
    console.log("install", e);
    //     (e as any).waitUntil(caches.open(cacheName).then(function(e) {
    //         return setOfCachedUrls(e).then(function(n) {
    //             return Promise.all(Array.from(urlsToCacheKeys.values()).map(function(t) {
    //                 if (!n.has(t)) {
    //                     var a = new Request(t,{
    //                         credentials: "same-origin"
    //                     });
    //                     return fetch(a).then(function(n) {
    //                         if (!n.ok)
    //                             throw new Error("Request for " + t + " returned a response with status " + n.status);
    //                         return cleanResponse(n).then(function(n) {
    //                             return e.put(t, n)
    //                         })
    //                     })
    //                 }
    //             }))
    //         })
    //     }).then(function() {
    //         return self.skipWaiting()
    //     }))
})
self.addEventListener("activate", (e) => {
    console.log("activate");
    e.waitUntil(self.clients.claim());
    const n = new Set(urlsToCacheKeys.values());
    e.waitUntil(caches.open(cacheName).then(function(e) {
        return e.keys().then(function(t) {
            return Promise.all(t.map(function(t) {
                if (!n.has(t.url))
                    return e.delete(t)
            }))
        })
    }).then(function() {
        return self.clients.claim()
    }))
})
self.addEventListener("fetch", (e) => {
    console.log("fetch", e);
    //   if ("GET" === e.request.method) {
    //       var n, t = stripIgnoredUrlParameters(e.request.url, ignoreUrlParametersMatching);
    //       n = urlsToCacheKeys.has(t);
    //       n || (t = addDirectoryIndex(t, "index.html"),
    //       n = urlsToCacheKeys.has(t));
    //       !n && "navigate" === e.request.mode && isPathWhitelisted([], e.request.url) && (t = new URL("index.html",self.location).toString(),
    //       n = urlsToCacheKeys.has(t)),
    //       n && e.respondWith(caches.open(cacheName).then(function(e) {
    //           return e.match(urlsToCacheKeys.get(t)).then(function(e) {
    //               if (e)
    //                   return e;
    //               throw Error("The cached response that was expected is missing.")
    //           })
    //       }).catch(function(n) {
    //           return console.warn('Couldn\'t serve response for "%s" from cache: %O', e.request.url, n),

})
// self.addEventListener("activate", function(e) {
//         console
// }?

