# pdf-to-txt — PDF to Text Converter (Node.js CLI)

Extract text from PDF files to plain `.txt` with a simple **Node.js command-line tool**. Convert a single PDF or batch-process an entire folder — useful for indexing, search, LLM pipelines, and document workflows.

Text-based PDFs only — scanned or image-only PDFs need OCR.

## Features

- Convert one PDF or a whole directory to `.txt`
- Custom output path (`-o` / `--out`)
- Print extracted text to stdout (`--stdout`)
- Zero GUI — scriptable for automation and CI

## Setup

```bash
cd pdf-to-txt
npm install
```

## Usage

```bash
# Convert all PDFs in ./input → ./output/*.txt
node src/cli.js ./input

# Single file (writes to ./output by default)
node src/cli.js report.pdf

# Explicit output path
node src/cli.js report.pdf -o report.txt
node src/cli.js ./pdfs --out ./txt

# Print to stdout
node src/cli.js report.pdf --stdout
```

## Keywords

PDF to text, PDF text extraction, Node.js PDF CLI, convert PDF to TXT, batch PDF converter, extract text from PDF

## License

See repository license file if present.
