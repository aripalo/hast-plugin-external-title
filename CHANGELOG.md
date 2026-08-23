## 1.0.0 (2026-08-23)

### ⚠ BREAKING CHANGES

* package renamed to hast-plugin-external-title; requires
Sätteri (Astro v7+) instead of unified 11+. See the migration section in the
README.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

### Features

* add pluggable Cache interface with lowdb and memory backends ([26fd92f](https://github.com/aripalo/hast-plugin-external-title/commit/26fd92f0102235f63cf8372bf1c50609d31f78c7))
* ext link handling and improved html sanitzation ([bd6c60f](https://github.com/aripalo/hast-plugin-external-title/commit/bd6c60fcdbd7e62f5423478d3874c824cfea6303))
* extlink ([2ee0ac3](https://github.com/aripalo/hast-plugin-external-title/commit/2ee0ac392775b58cf4872f1c6a01829551bdd0ef))
* port from rehype plugin to Sätteri hast plugin ([ce7123c](https://github.com/aripalo/hast-plugin-external-title/commit/ce7123c136722e74bfdca81b0ba9181e3b0c6be3))
* require Node 22.11 or newer ([debb8ed](https://github.com/aripalo/hast-plugin-external-title/commit/debb8ed67e9dfa2fb8e81ac53624106f3ebbcd05))
* rewrite plugin entry as a unified Plugin with TTL, concurrency and options ([ac94766](https://github.com/aripalo/hast-plugin-external-title/commit/ac94766c477ae22e03539317022e6dd813742b0e))
* update isomorphic-dompurify to 3.22.0 and raise the Node floor ([3524bd3](https://github.com/aripalo/hast-plugin-external-title/commit/3524bd3d64f31d2ada405a4362489adb1d22dd68))

### Bug Fixes

* bound external fetches by deadline, content type and head end ([3ef1bed](https://github.com/aripalo/hast-plugin-external-title/commit/3ef1bed131f9f005d2ebae8913fdd2ed980b07e9))
* only set a title when the fetched head is provably complete ([bb55762](https://github.com/aripalo/hast-plugin-external-title/commit/bb557629ed03720258270366526e6bfae4d5db75))

### Documentation

* add README for rehype-external-link-title ([d0d8b95](https://github.com/aripalo/hast-plugin-external-title/commit/d0d8b95b1a83921d94aca55cbee745d95adec32a))

### Build System

* add coverage package ([05d0cbd](https://github.com/aripalo/hast-plugin-external-title/commit/05d0cbd917b0298750437ebca7123ae2d8f89e5d))
* bump the dev-dependencies group with 5 updates ([dd131f0](https://github.com/aripalo/hast-plugin-external-title/commit/dd131f0b51847a9d27dba7fa5eda1a5629f43427))
* bump up nodejs version ([a17992c](https://github.com/aripalo/hast-plugin-external-title/commit/a17992ca8aa6cd9e7be6ada0e92f178aceed5118))
* declare the development runtime with devEngines ([d24d78f](https://github.com/aripalo/hast-plugin-external-title/commit/d24d78f8bcd1958d18a861d857c47a0962674f3c))
* pin patched transitive dev dependencies ([e536d70](https://github.com/aripalo/hast-plugin-external-title/commit/e536d70fdc1b626242d19df491efc160a3f134df))
* setup build system using tsdown ([2c8f5ad](https://github.com/aripalo/hast-plugin-external-title/commit/2c8f5adea044a4e5d5294bdad0f6fd217d1d1b25))
* update prepack and prepublishOnly scripts in package.json ([e6e5502](https://github.com/aripalo/hast-plugin-external-title/commit/e6e55025228d07be5003edb586184d9813d82ce5))
* update target nodejs version ([bbd7b80](https://github.com/aripalo/hast-plugin-external-title/commit/bbd7b800a028fa64ecb5e69566f0193ee2cc7088))
