// TODO: does this get pulled, because only using types for now
import { NormalizedDependencyResult } from "src/normalizeddependencies";
import { implementation } from "src/serviceworker/websocketwithdev/Client";

// mempack: embed-dependencies

/*
goals:
- progress till web is loaded
- measure network speed to understand quality of images to be loaded for best
  trade off
- try load more important things first (above the fold), eg by using own socket
  to fetch data, does this make sense ?
- don't load twice
- looks like partial images can be send by Response.Response :) *wow*
  but not IE, could be of interest to mobile

Test fetching with priority, eg using socket

Strategy: once completed, store completion, so that when restarting no work has to be done

This way cache doesn't have to be rechecked
on the other hand if user closes and reopesn rechecking does make sense to ensure everything has been downloaded

opitons

https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory
-> 1 or smaller -> small images

TODO: think about measuring download speed to understand size of images ?

Testing Implementation

1) Websocket for dev updates and prioritizing
   more recent requests are more important
   you can signal 'less important backgrountd fetching'

*/

const dM = navigator.deviceMemory

const app_versions: {
  bundles: {[key: string]: NormalizedDependencyResult },
  current: string,
}  = { bundles: {}, current: "" }

// IMPLEMENTATION 1https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory

const i = implementation({
    url: "wss://domain/...",
    // clientOptions: undefined,
    event: (e) => {
    },
})

const cacheName = "cache"

self.addEventListener("install", function(e) {
    // console.log("install", e);
    // (e as any).waitUntil(caches.open(cacheName).then(function(e) {
    //     return setOfCachedUrls(e).then(function(n) {
    //         return Promise.all(Array.from(urlsToCacheKeys.values()).map(function(t) {
    //             if (!n.has(t)) {
    //                 const a = new Request(t, {
    //                     credentials: "same-origin",
    //                 });
    //                 return fetch(a).then(function(n) {
    //                     if (!n.ok)
    //                         throw new Error("Request for " + t + " returned a response with status " + n.status);
    //                     return cleanResponse(n).then(function(n) {
    //                         return e.put(t, n)
    //                     })
    //                 })
    //             }
    //         }))
    //     })
    // }).then(function() {
    // }))
        return self.skipWaiting()
})
self.addEventListener("activate", function(e) {
    console.log("activate" );
    // get more, we want to claim as early as possible ..
    self.clients.claim()

    // var n = new Set(urlsToCacheKeys.values());
    // e.waitUntil(caches.open(cacheName).then(function(e) {
    //     return e.keys().then(function(t) {
    //         return Promise.all(t.map(function(t) {
    //             if (!n.has(t.url))
    //                 return e.delete(t)
    //         }))
    //     })
    // }).then(function() {
    //     return
    // }))
})
self.addEventListener("fetch", function(e) {
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
  //           fetch(e.request)
  //       }))
  //   }
});

/*
"use strict";
function setOfCachedUrls(e) {
    return e.keys().then(function(e) {
        return e.map(function(e) {
            return e.url
        })
    }).then(function(e) {
        return new Set(e)
    })
}
var precacheConfig = [["/assets/favicon.ico", "53ac170e970ad034a55ee15ce198708c"], ["/assets/icons/android-chrome-192x192.png", "1ea58b225a597f78adfd987ed164e573"], ["/assets/icons/android-chrome-512x512.png", "b65626103d4cd30abdb0423e6ab15179"], ["/assets/icons/apple-touch-icon.png", "4e32b9c4edcb5babb823e4824f90bb8d"], ["/assets/icons/favicon-16x16.png", "2cbedfd68f59e42b0d03ba3946863ee7"], ["/assets/icons/favicon-32x32.png", "b9108564a20f06675f60b29337c71b3e"], ["/assets/icons/mstile-150x150.png", "3eb725b0686148a67f2feb546670b313"], ["/bundle.js", "2ab01fc928bde7dcf5ff001c0b1da7df"], ["/favicon.ico", "53ac170e970ad034a55ee15ce198708c"], ["/index.html", "770a9e144f0880d0f3934b4954ed9b69"], ["/manifest.json", "409a6ab1239000b8c4b64cf7c808d616"], ["/polyfills.chunk.5379db062ae13637dd07.js", "2aad7229222ea514cd2cca4fdb877ac5"], ["/push-manifest.json", "c01d694154b84e51d1f9adaf7f3d0fa8"], ["/route-home.chunk.e029a9566f2da43c7670.js", "9c71f292dcab3bca4c9a54cce81bda15"], ["/route-profile.chunk.5d718e48f1ac12fd8068.js", "bc7b1ff688664ae4adfe85b474bcb646"], ["/style.css", "2c6f84b6ce45f29c37a44920ecff06e3"]]
  , cacheName = "sw-precache-v3-sw-precache-webpack-plugin-" + (self.registration ? self.registration.scope : "")
  , ignoreUrlParametersMatching = [/^utm_/]
  , addDirectoryIndex = function(e, n) {
    var t = new URL(e);
    return "/" === t.pathname.slice(-1) && (t.pathname += n),
    t.toString()
}
  , cleanResponse = function(e) {
    return e.redirected ? ("body"in e ? Promise.resolve(e.body) : e.blob()).then(function(n) {
        return new Response(n,{
            headers: e.headers,
            status: e.status,
            statusText: e.statusText
        })
    }) : Promise.resolve(e)
}
  , createCacheKey = function(e, n, t, a) {
    var r = new URL(e);
    return a && r.pathname.match(a) || (r.search += (r.search ? "&" : "") + encodeURIComponent(n) + "=" + encodeURIComponent(t)),
    r.toString()
}
  , isPathWhitelisted = function(e, n) {
    if (0 === e.length)
        return !0;
    var t = new URL(n).pathname;
    return e.some(function(e) {
        return t.match(e)
    })
}
  , stripIgnoredUrlParameters = function(e, n) {
    var t = new URL(e);
    return t.hash = "",
    t.search = t.search.slice(1).split("&").map(function(e) {
        return e.split("=")
    }).filter(function(e) {
        return n.every(function(n) {
            return !n.test(e[0])
        })
    }).map(function(e) {
        return e.join("=")
    }).join("&"),
    t.toString()
}
  , hashParamName = "_sw-precache"
  , urlsToCacheKeys = new Map(precacheConfig.map(function(e) {
    var n = e[0]
      , t = e[1]
      , a = new URL(n,self.location)
      , r = createCacheKey(a, hashParamName, t, !1);
    return [a.toString(), r]
}));
self.addEventListener("install", function(e) {
    e.waitUntil(caches.open(cacheName).then(function(e) {
        return setOfCachedUrls(e).then(function(n) {
            return Promise.all(Array.from(urlsToCacheKeys.values()).map(function(t) {
                if (!n.has(t)) {
                    var a = new Request(t,{
                        credentials: "same-origin"
                    });
                    return fetch(a).then(function(n) {
                        if (!n.ok)
                            throw new Error("Request for " + t + " returned a response with status " + n.status);
                        return cleanResponse(n).then(function(n) {
                            return e.put(t, n)
                        })
                    })
                }
            }))
        })
    }).then(function() {
        return self.skipWaiting()
    }))
}),
self.addEventListener("activate", function(e) {
    var n = new Set(urlsToCacheKeys.values());
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
}),
self.addEventListener("fetch", function(e) {
    if ("GET" === e.request.method) {
        var n, t = stripIgnoredUrlParameters(e.request.url, ignoreUrlParametersMatching);
        n = urlsToCacheKeys.has(t);
        n || (t = addDirectoryIndex(t, "index.html"),
        n = urlsToCacheKeys.has(t));
        !n && "navigate" === e.request.mode && isPathWhitelisted([], e.request.url) && (t = new URL("index.html",self.location).toString(),
        n = urlsToCacheKeys.has(t)),
        n && e.respondWith(caches.open(cacheName).then(function(e) {
            return e.match(urlsToCacheKeys.get(t)).then(function(e) {
                if (e)
                    return e;
                throw Error("The cached response that was expected is missing.")
            })
        }).catch(function(n) {
            return console.warn('Couldn\'t serve response for "%s" from cache: %O', e.request.url, n),
            fetch(e.request)
        }))
    }
});
*/
