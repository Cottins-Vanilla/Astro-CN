# Third-party notices

Astro itself is MIT licensed (see [LICENSE](LICENSE)). This file covers third-party material that
is **redistributed inside this repository**, which carries its own conditions.

npm dependencies are not listed here: they are fetched at install time, not vendored, and each
keeps its own license in `node_modules`.

---

## d3-celestial — constellation line figures

**What:** the IAU constellation line-figure data behind Constellation Mode.

**Where in this repo:**

- `apps/web/src/graph3d/layouts/patterns.ts` — the bundled fallback set, re-derived from the
  upstream GeoJSON into a normalized local coordinate frame by
  `scripts/build-constellation-patterns.js`. A derivative work of the upstream data.
- `packages/core/src/constellationData.ts` — the transform itself. Contains no upstream data.
- `apps/desktop/src/constellations.ts` — the opt-in "download the constellation database" feature,
  which fetches the upstream files at runtime from
  `https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/`.

**Upstream:** https://github.com/ofrohn/d3-celestial — license file at
https://github.com/ofrohn/d3-celestial/blob/master/LICENSE

**License:** BSD 3-Clause. Reproduced below (SPDX `BSD-3-Clause` text, with the upstream project's
own copyright line). The upstream `LICENSE` linked above is authoritative.

```
BSD 3-Clause License

Copyright (c) 2015, Olaf Frohn
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

Clause 3 is why nothing in Astro's own naming or marketing invokes d3-celestial or Olaf Frohn as
an endorsement; the references in this repo are attribution only.
