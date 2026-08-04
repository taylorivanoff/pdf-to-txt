# PDF to TXT - Desktop PDF Text Extractor

[![Release](https://img.shields.io/github/v/release/taylorivanoff/pdf-to-txt)](https://github.com/taylorivanoff/pdf-to-txt/releases)
[![Downloads](https://img.shields.io/github/downloads/taylorivanoff/pdf-to-txt/total)](https://github.com/taylorivanoff/pdf-to-txt/releases)
[![License](https://img.shields.io/github/license/taylorivanoff/pdf-to-txt)](LICENSE)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow?style=flat&logo=buy-me-a-coffee)](https://buymeacoffee.com/taylorivanoff)

**PDF to TXT** is a free, cross-platform **Electron desktop app** (with a CLI) that extracts text from PDF files into plain `.txt`. Queue files or folders, preview extraction, and batch-convert — useful for indexing, search, LLM pipelines, and document workflows.

Text-based PDFs only — scanned or image-only PDFs need OCR.

## Features

- Drag-and-drop or pick PDFs / folders into a convert queue
- Live text preview before convert
- Batch convert to a chosen output folder
- Tray icon with show/hide, optional always-on-top, start minimised, updates
- Window bounds persistence, splash screen, single-instance, auto-updater
- Close hides to tray (Quit from tray menu)
- CLI retained for scripts and CI (`bun run cli`)

## Installation

1. Download the latest installer from [Releases](https://github.com/taylorivanoff/pdf-to-txt/releases)
2. Run the installer and follow the prompts

## Development

```bash
bun install
bun run start
```

### CLI

```bash
bun run cli ./input
bun run cli report.pdf -o report.txt
bun run cli report.pdf --stdout
```

### Building

```bash
bun run release
```

### Releasing

Bump the `version` in `package.json` and push to `master`. The GitHub Actions workflow builds installers and creates a GitHub Release.

Optional repo secrets for signed builds:

- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`

## Usage

1. Add PDFs or a folder (or drop them on the window)
2. Click a file to preview extracted text
3. Optionally set an output folder
4. Click **Convert**

## Notes

- Uses [unpdf](https://www.npmjs.com/unpdf) (PDF.js) for text-layer extraction
- Default output folder is `Documents/PDF to TXT` if none is set

## Keywords

PDF to text, PDF text extraction, convert PDF to TXT, batch PDF converter, Electron PDF app, desktop PDF extractor

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
