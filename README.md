# LaTeX Visual Editor

A VS Code extension that provides a visual editor for LaTeX documents. It is inspired by Overleaf's visual editor and uses the same interface and parser.

## Usage

Open a `.tex` file and click the eye icon in the editor title bar to toggle the
visual editor.

## Development

```powershell
npm install
npm run check
npm run build
```

Package and install the verified bundle:

```powershell
npm run package
code --install-extension latex-visual-editor-0.1.0.vsix --force
```

Reload the VS Code window after installation.
