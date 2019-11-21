mempack - WHY
=============
* Try to hot reload code without writing intermediary JS files to disk at all - why waste time on this?
* simple HMR for Node
* future: HMR for web worker or cilent
* Background loading of modules (webworker) *while* lodaing most important modules required by page first
  maximizing user experience.
  This is using 'sync' loading but was the best compromise I was able to find because turning code into async cannot be done in a safe way
* internal versioned representation of updates keeping copies of files and derived results only once in cache
  So you can ensure that your node app runs same version in database and the like.

This is an experiment to find out whether existing package managers / bundlers (fusebox, webpack)
'have been doing it wrong all the time' for development. When bundling and running stable code there
are no benefits to be expected.

This is work in progress. If you know better solutions let me know.

Also see  related projects (tsmono) below

lazy loading with synced ajax requests - why ?
=========================
short answer: Because turning code into async is worse.

long answer: Because its the best I came up with. The important goals I followed are
* get up and running as fast as possible
* maximize reusing cache
* blocking is bad, but the alternative rewriting all code using async style is worse
  moreover it might not be worse than the 'loading files, please wait' screens shown by many designs

With webworkers and offline caching in mind there is a problem, because there are 2 competing goals
    1) fill the cache
    2) load files required to render page with higher priority
I will try to implement a socket, then you can send the server a list of all files to be tranmitted, and which ones
are to be transmitted eariler. This probably still means you'll get some lag due to nodes in the TCP/stack getting jammed,
so maybe you can use 2 pipes to distribute load in some way.

Then you can use deprecated (:-())  sync requests to get modules, serve from cache if they have been loaded earlier (should be fast the second time) while implementing 'focus' on what to load first.

Also the webworker can reuse existing requests and reschedule and prevent multiple requests.
From web page this can only be done using async .. hell.

This is an experiment. So let's hope it just works ..

If you know a better way without rewriting compilers and introducing 'blocking' primitives and whatnot let me know.

Q: But isn't sync loading slower than async ? Probably yes, but because dependency analysis can be done in a strict way
   the server can keep sending so should be 'close' to async speed eventually or *good enough*. We'll see.

FEATURES
========
* for development operates in memory for HMR (client & server) thus fastest or very fast.

Notes about: HMR - TS / JS hot reloading
========================================
JS/TS was never designed with HMR in mind.
Thus HMR comes with some ambiguities. Example:

```JS
export const globalCache = globalCache || new_global_cache()
```

cannot be typed in TS. So current recommended solution is to move code which should not be reloaded in 'nohmr' so that reloading of those files will not be triggered and be moving code which needs to be reloaded often to be moved in separate files, not triggering reload of not to be reloaded code.

There are more open questions such export class = .. members. More work to be done

Much work to be done for REACT like libraries I think beacuse they even might have special annotations.

There are alternatives such as 
* https://github.com/whitecolor/ts-node-dev
* nodemon (which allow to set your own node command thus you can use node  -r tsconfig-paths/register -r ts-node/register/transpile-only

but eventually you start connecting to databases and more thus restarting from scratch reloading all code probbaly is slower.

special comments
========================================

// mempack:: embed-dependencies
-> for serviceworker: embed all dependencies for speed in same file
see samples/server-client-webworker-update

using own format so that shared dependencies can be served to website without
additional loading.


INTERNAL STRUCTURE
==================
dependencies.ts -> only creates dependencies based on files on disk. Duplicates allowed

normalizeddependencies.ts -> from that create dependencies turning files into hash. Hash should be based on hashes of depnedencies.
Thus if two libraries contain same dependency subtree it should turn into the same ..
 
EXAMPLES
========

    node-hmr: change method.ts, then watch console.log changing its output almost immediately
    test it by: ( cd samples/node-hmr; tp --trace-warnings main.ts; )

    server-client-modules:
    * hot reload express server code which was put into its own hmr module ..
    test it by: ( cd samples/server-client-modules/; tp --trace-warnings main.ts; )

    server-client-webworker-update (TODO)
    * hot reload express server (like server-client-modules)
    * hot reload client code via webworker

    Note: because service worker requires being served from https ....
    test it by: ( cd samples/server-client-webworker-update/; tp --trace-warnings main.ts; )


KNOWN BUGS
=========
* TranspileLazy does use dump string replacement. If you use the imported names in the code the 
   name might get replaced in strings and intorduce bugs. Fix is easy, rename the imported name.
   or help me write proper implementation
   (fixable)

ROADMAP
=======
[x] dependency analysis & watching for changes & dirty management
[x] normalized graph with hashes based on file behavior for fastest updates

// needs update
[x] es modules in browser (for testing)
[?] transcription
[x] hot reloading node (server)  -> works but maybe can even be done simple by watching files and integrating
    with ts-node which would mean giving up shared cache which is not impelmented anyway
    There is also https://github.com/whitecolor/ts-node-dev which has --respawn option but doesn't do hot module reloading apparently
[ ] document how lazy loading is implemented and why
[ ] hot reloading TS / JS in browser worker
[ ] hot reloading TS / JS client via web worker
[ ] css / sass resources / update
[ ] import css within modules / component files
    publication at submissions@javascriptinplainenglish.com
[ ] allow CDNs urls ?
[ ] use ReactiveX (ReactJS) for some patterns eg Watcher to manager freeing
    - not important enough right now because no freeing is going to take place
    for most simple use cases
[ ] benchmark dependency tree and see why it takes so long despite most things should be in cache ?
    ( cd samples/node-hmr; tp --trace-warnings main.ts; )
[ ] drop dependencies eg ttslib/fusebox by moving code here
[ ] think about depednencies ttslib, move code here ?
[ ] TranspileLazy -> proper AST based implementation which does not
    manipulate string contents by accident - workarounds
[ ] skip empty modules (eg if a module only contains type definitions)

RESOURCES
=========
https://github.com/Microsoft/TypeScript/wiki/Using-the-Compiler-API


how to use?
==========

TODOs
======
* Talk to nchanged to move fasntanalysis into its own module.
* https://github.com/callstack/linaria
* polyfills ? find out what to look for by looking at code ?
  .text -> Blob.text() like etc ?


Thanks to
=========
Fusebox for fastanalysis implementation especally nchanged


How to say thanks?
==================

* Give me money because *I am saving you seconds on each update summing up over life time*.
  (talk to me)

* Support future projects which go beyond TypeScript - talk to me. You can
  invest from 50 EUR onwards. Thus if you like this and know investors let me
  know.

JS/TS still are doing much wrong, eg effect tracking, implicit await/async etc.
It can be done better and I will do it.


Failed ideas
============

* use typescript API to handle everything.
  Why?: You cannot limit bundling / actions to files belonging to entry files


Related projects
================
http://github.com/MarcWeber/tsmono

Allows to reference TS files and install modules along with types with one
string eg "deep-equal:types" so no .d.ts no .js mess anymore.
Only works if tstonfig settings are the same which probably is the case for
your own projects anyway.


Support me?
===========
I still think I am doing it wrong, because a lot of hinting cannot be expressed using JS/TS.

So if you want to change the world looking for investors in order to fix this all on the right level.

Even small amounts per month would help reaching the goals:
- optional memory management (like rust)
- abstract lazy loading, because the solution here will go away

I'd also investigate smarter databases and server/client collaborative shared state cloud solutions
like drive.google.com but for any kind of documents

Ping me (maybe multiple times in case I miss your mail)


MEMO SOCKET
================
> 1.200 byte packages might degrease performance on wireless networks thus havign packages smallen or up to 1.2K is ok.
writeable.cork -> uncorck till reaching such limit (or timeout such as 20ms -> then send)
How to encode/ decode messages ... ?



compare with this for performance ?
===================================
https://hnpwa.com/
