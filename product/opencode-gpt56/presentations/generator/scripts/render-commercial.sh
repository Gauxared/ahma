#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
GENERATED_DIR="$(CDPATH= cd -- "${ROOT_DIR}/.." && pwd)/generated"
QA_DIR="${GENERATED_DIR}/qa/commercial"
PAGES_DIR="${QA_DIR}/pages"
PPTX_PATH="${GENERATED_DIR}/01-stroyintellekt-commercial-universal.pptx"
PDF_PATH="${GENERATED_DIR}/01-stroyintellekt-commercial-universal.pdf"
TEXT_PATH="${QA_DIR}/extracted-text.txt"
CONTACT_SHEET_PATH="${QA_DIR}/contact-sheet.png"
VERIFY_PATH="${QA_DIR}/verification.txt"
PROFILE_DIR="${ROOT_DIR}/.libreoffice/commercial-${PPID}-$$"

cleanup() {
  rm -rf "${PROFILE_DIR}"
}
trap cleanup EXIT

fail() {
  printf 'render-commercial: %s\n' "$1" >&2
  exit 1
}

required_commands=(node libreoffice fc-match pdfinfo pdffonts pdftoppm pdftotext unzip)
for required_command in "${required_commands[@]}"; do
  command -v "${required_command}" >/dev/null 2>&1 || fail "missing required command: ${required_command}"
done

mkdir -p "${GENERATED_DIR}" "${QA_DIR}" "${ROOT_DIR}/.cache/fontconfig" "${PROFILE_DIR}"
rm -rf "${PAGES_DIR}"
mkdir -p "${PAGES_DIR}"
rm -f "${PPTX_PATH}" "${PDF_PATH}" "${CONTACT_SHEET_PATH}" "${TEXT_PATH}" "${VERIFY_PATH}"

export FONTCONFIG_FILE="${ROOT_DIR}/fontconfig/fonts.conf"
export XDG_CACHE_HOME="${ROOT_DIR}/.cache"

resolved_font_path="$(fc-match --format='%{file}' 'Montserrat')"
case "${resolved_font_path}" in
  "${ROOT_DIR}/assets/fonts/"*) ;;
  *) fail "Montserrat resolved outside generator assets: ${resolved_font_path:-not found}" ;;
esac

node "${ROOT_DIR}/src/build-commercial.mjs" "${PPTX_PATH}" >/dev/null
[[ -s "${PPTX_PATH}" ]] || fail "PowerPoint file was not created"

slide_count="$({ unzip -p "${PPTX_PATH}" ppt/presentation.xml \
  | node -e 'let xml=""; process.stdin.setEncoding("utf8"); process.stdin.on("data", c => xml += c); process.stdin.on("end", () => console.log((xml.match(/<p:sldId\b/g) || []).length));'; } 2>/dev/null)"
[[ "${slide_count}" == "32" ]] || fail "expected exactly 32 PPTX slides, got ${slide_count:-unknown}"

notes_count="$(unzip -Z1 "${PPTX_PATH}" | node -e 'let s=""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => console.log(s.split(/\r?\n/).filter(x => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(x)).length));')"
[[ "${notes_count}" == "32" ]] || fail "expected notes on 32 slides, got ${notes_count:-unknown}"

libreoffice \
  --headless \
  --nologo \
  --nodefault \
  --nofirststartwizard \
  "-env:UserInstallation=file://${PROFILE_DIR}" \
  --convert-to pdf \
  --outdir "${GENERATED_DIR}" \
  "${PPTX_PATH}" >/dev/null

[[ -s "${PDF_PATH}" ]] || fail "LibreOffice did not create the PDF"

page_count="$(pdfinfo "${PDF_PATH}" | node -e 'let s=""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => { const m=s.match(/^Pages:\s*(\d+)/m); console.log(m ? m[1] : ""); });')"
[[ "${page_count}" == "32" ]] || fail "expected exactly 32 PDF pages, got ${page_count:-unknown}"

embedded_montserrat="$(pdffonts "${PDF_PATH}" | node -e 'let s=""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => { const rows=s.split(/\r?\n/).filter(x => /Montserrat/i.test(x) && /\byes\b/i.test(x)); console.log(rows.length ? rows[0].trim().split(/\s+/)[0] : ""); });')"
[[ -n "${embedded_montserrat}" ]] || fail "PDF does not contain embedded Montserrat"

pdftoppm -png -r 144 "${PDF_PATH}" "${PAGES_DIR}/slide" >/dev/null
pages=("${PAGES_DIR}"/*.png)
[[ "${#pages[@]}" == "32" ]] || fail "expected 32 rendered PNG pages, got ${#pages[@]}"

node "${ROOT_DIR}/scripts/create-contact-sheet.mjs" "${PAGES_DIR}" "${CONTACT_SHEET_PATH}" >/dev/null
[[ -s "${CONTACT_SHEET_PATH}" ]] || fail "contact sheet was not created"

pdftotext -layout "${PDF_PATH}" "${TEXT_PATH}"
node - "${TEXT_PATH}" <<'NODE'
const fs = require('node:fs');
const text = fs.readFileSync(process.argv[2], 'utf8').replace(/\s+/g, ' ').toLowerCase();
const forbidden = [
  'lorem ipsum', 'placeholder', 'tbd', 'todo',
  'гарантирует экономию', 'заменяет девять специалистов',
  'готовая промышленная мультиагентная платформа', 'неограниченная производительность',
];
for (const phrase of forbidden) {
  if (text.includes(phrase)) throw new Error(`forbidden or placeholder phrase: ${phrase}`);
}
const required = [
  'от 20 млн', 'диагностика', 'доказательный пилот',
  'не входят в базовое внедрение', 'минимизированные', 'маскированные',
  'не заменяет', 'права использования', 'гарантия', 'сопровождение',
];
for (const phrase of required) {
  if (!text.includes(phrase)) throw new Error(`required PDF phrase missing: ${phrase}`);
}
NODE

{
  printf 'fontconfig Montserrat: %s\n' "${resolved_font_path}"
  printf 'pptx slides: %s\n' "${slide_count}"
  printf 'pptx notes: %s\n' "${notes_count}"
  printf 'pdfinfo pages: %s\n' "${page_count}"
  printf 'pdffonts embedded Montserrat: %s\n' "${embedded_montserrat}"
  printf 'rendered PNG pages: %s\n' "${#pages[@]}"
  printf 'placeholder and risky-phrase scan: PASS\n'
  printf 'contact sheet: %s\n' "${CONTACT_SHEET_PATH}"
} > "${VERIFY_PATH}"

cat "${VERIFY_PATH}"
