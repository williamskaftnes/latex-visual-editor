# Third-Party Notices

This project contains adapted portions of the Overleaf Community Edition web
frontend, primarily under `src/webview/overleaf-editor`. Overleaf Community
Edition is distributed under the GNU Affero General Public License. The files
in this repository have been modified to run locally inside a VS Code webview.

Upstream project:

- https://github.com/overleaf/overleaf

The LaTeX parser under
`src/webview/overleaf-editor/lezer-latex` is based on Overleaf's Lezer-LaTeX
parser and is distributed as part of this AGPL-3.0-only work.

`src/webview/overleaf-editor/utils/prepare-lines.ts` contains code adapted from
CodeMirror's autocomplete package under the MIT License. Its source attribution
is retained in that file.

Bundled runtime dependencies include CodeMirror, Lezer, Lodash, MathJax, and
Overleaf's `o-error` package. Their copyright and license terms are available
in their respective upstream distributions and npm package metadata.

The complete corresponding source and build scripts for the extension are
provided in this repository:

- https://github.com/williamskaftnes/latex-visual-editor
