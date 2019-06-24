mempack - WHY
=============
You've been doing it all wrong with webpack/ fusebox / .. for development
All said.

Yes, for production and similar tasks there will be modes writing to disk (TODO)
Ues webpack or whatever. I want to get my jobs done *FASTEST*

FEATURES
========
* for development operates in memory for HMR (client & server) thus fastest

Related projects
================
http://github.com/MarcWeber/tsmono

Allows to reference TS files and install modules along with types with one
string eg "deep-equal:types" so no .d.ts no .js mess anymore.
Only works if tstonfig settings are the same which probably is the case for
your own projects anyway.

ROADMAP
=======
[0.5] dependency analyiss & watching for changes & dirty management
[x] es modules in browser
[?] transcription
[ ] hot reloading server
[ ] hot relodaing client via web worker
[ ] hot relodaing without web worker
[ ] css / sass resources / update
[ ] import css within modules / component files
    publication at submissions@javascriptinplainenglish.com
[ ] allow CDNs urls ?


RESOURCES
=========
https://github.com/Microsoft/TypeScript/wiki/Using-the-Compiler-API


how to use?
==========
TODO

TODOs
=====
* Talk to nchanged to move fasntanalysis into its own module.
* https://github.com/callstack/linaria

Thanks to
=========
Fusebox for fastanalysis implementation especally nchanged

How to say thanks?
==================

* Give me money because *I am saving you seconds on each update summing up over life time*.
  (talk to me)

* Support future projects which go beyond TypeScript - talk to me. You can
  invest from 50 EUR anwards. Thus if you like this and know investors let me
  know.

JS/TS still are doing much wrong, eg effect tracking, implicit await/async etc.
It can be done better and I will do it.

Failed ideas
============

* use typescript API to handle everything.
  Why?: You cannot limit bundling / actions to files belonging to entry files
