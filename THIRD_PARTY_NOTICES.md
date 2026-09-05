# Third-party notices

The project's MIT license covers its original application code. Dependencies
retain their respective licenses and notices.

## gif.js

`public/gif.worker.js` is the gif.js 0.2.0 worker distributed by Johan Nordberg.
The missing source-map reference was removed; the encoder code is unchanged.
The gif.js library is also installed from npm.

- Source: https://github.com/jnordberg/gif.js
- License: MIT; reproduced in [licenses/gif.js-LICENSE](licenses/gif.js-LICENSE)
- Original copyright: 2013–2018 Johan Nordberg

Keep the worker's header and its license notice when redistributing it.

## Runtime libraries

- React and React DOM: MIT, https://github.com/facebook/react
- Three.js: MIT, https://github.com/mrdoob/three.js

Dependency packages include their own copyright and license information.
See `package-lock.json` for the exact installed dependency versions.
