# File previews

Chat, Work and Bot files use the same viewer in `apps/web/src/features/files`.
Images, PDF, Markdown, text, HTML, CSV and XLSX have built-in previews. Audio and
video use Chromium playback. Other formats show a download notice. Desktop users
can save a file, open its local copy or reveal its location. Word and PowerPoint
use these file actions.

## Limits and ownership

Attachments allow 100 MiB per file, 250 MiB per message and ten files per message.
Text-tool reads retain their separate 10 MiB limit. Uploads and downloads use
bounded streams. File IDs resolve within the authenticated Bot boundary.
Original files remain unchanged.

XLSX uses SheetJS CE 0.20.3 from its official distribution. The parser runs in a
cancellable child process with a 30-second timeout. ZIP expansion is limited to
128 MiB and 10,000 entries. The selected sheet returns at most 500 rows and 50
columns. Saved formula values are displayed. Formulas and macros are not
executed. The V8 heap limit is not a hard cap on total process memory.

Spreadsheet results have a 512 MiB/100-entry cache. File content and parser
implementation determine cache identity. Closing the last reader cancels an
unfinished parse. Scrolling past a card does not start spreadsheet parsing.

Audio and video use authenticated Range responses. A file extension identifies
a container, not a supported codec. Failed decoding keeps download and
system-open actions. Desktop actions resolve file IDs through the authenticated
service and create local copies. Renderer code cannot supply an arbitrary
operating-system path.

## Verification

Agent tests cover file limits, streaming, cancellation, spreadsheet formatting,
ZIP expansion limits and document fallback selection. API tests cover Range
reads, Bot ownership, spreadsheet reads and original document downloads.
Electron tests cover PDF, text, tables, media, document fallback, save, system
open, file location, themes and narrow windows. Shell calls are intercepted for
verification. Tests do not launch an associated external application.
