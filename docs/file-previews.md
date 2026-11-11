# File previews and verification

Files owns immutable originals and derived previews. Chat, Work and Bot files use
the same viewer. Opening a preview starts conversion. Scrolling past a card does
not start conversion. Attachments allow 100 MiB per file, 250 MiB per message and
ten files per message. Text-tool reads retain their separate limit.

## Runtime dependencies and limits

XLSX uses SheetJS CE 0.20.3 from its official distribution. The parser runs in a
cancellable child process. ZIP expansion is limited to 128 MiB and 10,000 entries.
The selected sheet returns at most 500 rows and 50 columns. Saved formula values
are displayed. Formulas and macros are not executed.

Office previews require LibreOffice on the computer that runs the Domos service.
Windows uses the installed `soffice.com`. macOS uses the installed application.
Linux uses `libreoffice` or `soffice` on PATH. The deployment image installs Writer,
Impress and Noto CJK fonts. A missing converter leaves download and system-open
actions available. Local containers do not need a second converter: conversion
uses the immutable snapshot in the owning service.

Conversions use a separate temporary profile, disabled macros and automatic
Writer link updates, one queued process, and a 30-second timeout. Headless mode
is not an operating-system sandbox. The converter runs as the service account.
The V8 heap limit is not a hard cap on total process or ArrayBuffer memory.
Derived data has a 512 MiB/100-entry cache. Converter version, font metadata and
parser implementation participate in cache identity. Office layout can differ
from the original. PPT animation is outside the static preview.

Audio and video use Chromium controls and authenticated Range responses. A file
extension identifies a container, not a supported codec. Failed decoding keeps
download and system-open actions. Desktop actions resolve a file ID through the
authenticated service and create a local copy. Renderer code cannot supply an
arbitrary operating-system path.

## Windows measurements: 2026-11-12

The machine used Windows 11 build 26200, Ryzen 7 8845H, 16 GB RAM, NVMe storage,
Radeon 780M and RTX 4050 Laptop GPUs. Electron reported 44.8.0, Chromium
152.0.7977.167 and Node 24.22.0. Service benchmarks used Node 24.22.2.
LibreOffice reported 26.8.2.2. These measurements are local samples, not a
cross-platform performance guarantee.

| Work measured | Samples | Result |
| --- | ---: | --- |
| Authenticated HTTP upload, 100 MiB | 30 | P50 952 ms; P95 1,819 ms |
| Authenticated HTTP download and SHA-256, 100 MiB | 30 | P50 194 ms; P95 300 ms; all hashes match |
| HTTP server private-commit growth across those rounds | 30 | Peak above initial sample: 97 MiB |
| Service upload throughput against equal-I/O/hash reference | 30 | P95 throughput ratio: 77% |
| One service upload/download, 100 MiB | 1 | Additional private commit: 53.3 MiB |
| XLSX service parsing, 100,000 rows, about 10 MiB | 30 | P95 717 ms; cached read 11.9 ms |
| Word service conversion, 20 pages | 30 | P95 4,414 ms; cached read 193 ms |
| PPT service conversion, 30 slides | 30 | P95 4,517 ms; cached read 197 ms |
| Native 1080p H.264 video seek through next frame | 30 | P50 133 ms; P95 160 ms |

Preview service timings exclude UI paint. First conversion means no derived
cache; it does not mean a cold operating-system disk cache. The preview sample
set was resumed after an interrupted benchmark. It is not an uninterrupted
release soak. The measured conversion process tree peaked near 706 MiB. That
includes the parser host and converter helpers. It does not establish the
512 MiB converter-only target. A separate 30-round service-memory probe peaked
141 MiB above baseline. Repeated-operation memory acceptance remains open.

The Electron test recorded `D3D11VideoDecoder` and platform video decoding for
the H.264 samples. It recorded zero dropped frames among 991 reported frames.
The short fixture and seek exercise do not establish sustained playback quality.
The test's `firstPreviewMs` field includes functional checks and seeks; the Word
sample also includes a controlled screenshot delay. It is not a first-frame,
first-audio or first-paint benchmark.

Raw local records are under `tmp/file-performance/`: `http-transfer.json`,
`transfer.json`, `single-memory.json`, `product-memory.json`, `previews.json`,
`preview-memory-final.json` and `desktop.json`. They retain samples and available
versions, hashes, decoder events and process metrics. They are not product data.

## Functional checks and remaining acceptance

Vitest passed 523 tests in 70 files. Four files and 44 tests were skipped by the
existing platform/test conditions. Focused Web Playwright passed 13 tests.
Electron native setup passed against the bundled service. The desktop files
test passed with real XLSX, DOCX, PPTX, MP3, MP4 and MOV fixtures. It covers Range
seeks, Chinese document text, an unsupported ProRes codec, save overwrite and
cancel, invalid IPC identity, conversion failure and retry, themes and a narrow
window. Typecheck passed. Lint passed with 12 retained warnings.

System-open and reveal calls were intercepted at the Electron shell boundary.
Their downloaded bytes and local paths were checked. Launching an associated
external application was not verified. Conversion failure screenshots use a
controlled error response. Successful Office retries use the real converter.

The complete proposed performance acceptance is not finished. Remaining checks
include the eight-hour soak, startup regression against a frozen baseline,
input latency, first-frame/audio latency, physical audio loopback, sustained
CPU/GPU and stutter sampling, and Linux/macOS runs. Docker was unavailable on
the test host; the updated image was not built. A passing functional test suite
does not replace these checks. Dependency or font changes require the relevant
preview benchmarks again with the same sample hashes and machine conditions.
