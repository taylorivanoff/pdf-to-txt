# pdf-to-txt

Node CLI that extracts text from PDF files into `.txt`.

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

Text-based PDFs only — scanned/image PDFs need OCR.
