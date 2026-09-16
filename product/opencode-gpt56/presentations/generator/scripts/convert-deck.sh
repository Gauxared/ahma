#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE_DIR="${ROOT_DIR}/.libreoffice/convert-${PPID}-$$"

cleanup() {
  rm -rf "${PROFILE_DIR}"
}
trap cleanup EXIT

fail() {
  printf 'convert-deck: %s\n' "$1" >&2
  exit 1
}

[[ $# -ge 1 && $# -le 2 ]] || fail "usage: convert-deck.sh <deck.pptx> [output-directory]"

required_commands=(node libreoffice fc-match pdfinfo pdffonts unzip)
for required_command in "${required_commands[@]}"; do
  command -v "${required_command}" >/dev/null 2>&1 \
    || fail "missing required command: ${required_command}"
done

PPTX_PATH="$(node -e 'console.log(require("node:path").resolve(process.argv[1]))' "$1")"
[[ -s "${PPTX_PATH}" ]] || fail "PowerPoint file not found or empty: ${PPTX_PATH}"
[[ "${PPTX_PATH,,}" == *.pptx ]] || fail "expected a .pptx file: ${PPTX_PATH}"

if [[ $# -eq 2 ]]; then
  OUTPUT_DIR="$(node -e 'console.log(require("node:path").resolve(process.argv[1]))' "$2")"
else
  OUTPUT_DIR="$(dirname -- "${PPTX_PATH}")"
fi

mkdir -p "${OUTPUT_DIR}" "${PROFILE_DIR}" "${ROOT_DIR}/.cache/fontconfig"

export FONTCONFIG_FILE="${ROOT_DIR}/fontconfig/fonts.conf"
export XDG_CACHE_HOME="${ROOT_DIR}/.cache"

resolved_font_path="$(fc-match --format='%{file}' 'Montserrat')"
case "${resolved_font_path}" in
  "${ROOT_DIR}/assets/fonts/"*) ;;
  *) fail "Montserrat resolved outside generator assets: ${resolved_font_path:-not found}" ;;
esac

slide_count="$({ unzip -p "${PPTX_PATH}" ppt/presentation.xml \
  | node -e 'let xml=""; process.stdin.setEncoding("utf8"); process.stdin.on("data", chunk => xml += chunk); process.stdin.on("end", () => console.log((xml.match(/<p:sldId\b/g) || []).length));'; } 2>/dev/null)"
[[ "${slide_count}" =~ ^[1-9][0-9]*$ ]] || fail "could not determine slide count from PPTX"

base_name="$(basename -- "${PPTX_PATH}")"
PDF_PATH="${OUTPUT_DIR}/${base_name%.*}.pdf"
rm -f "${PDF_PATH}"

libreoffice \
  --headless \
  --nologo \
  --nodefault \
  --nofirststartwizard \
  "-env:UserInstallation=file://${PROFILE_DIR}" \
  --convert-to pdf \
  --outdir "${OUTPUT_DIR}" \
  "${PPTX_PATH}" >/dev/null

[[ -s "${PDF_PATH}" ]] || fail "LibreOffice did not create a PDF: ${PDF_PATH}"

page_count=""
while IFS=: read -r key value; do
  if [[ "${key}" == "Pages" ]]; then
    page_count="${value//[[:space:]]/}"
  fi
done < <(pdfinfo "${PDF_PATH}")
[[ "${page_count}" == "${slide_count}" ]] \
  || fail "page count mismatch: PPTX has ${slide_count}, PDF has ${page_count:-unknown}"

embedded_montserrat=""
while IFS= read -r font_line; do
  read -r -a font_columns <<< "${font_line}"
  ((${#font_columns[@]} >= 6)) || continue
  [[ "${font_columns[0]}" == *Montserrat* ]] || continue

  embedded_index=$((${#font_columns[@]} - 5))
  if [[ "${font_columns[embedded_index]}" == "yes" ]]; then
    embedded_montserrat="${font_columns[0]}"
    break
  fi
done < <(pdffonts "${PDF_PATH}")
[[ -n "${embedded_montserrat}" ]] || fail "PDF does not contain embedded Montserrat"

printf 'fontconfig Montserrat: %s\n' "${resolved_font_path}"
printf 'pptx slides: %s\n' "${slide_count}"
printf 'pdfinfo pages: %s\n' "${page_count}"
printf 'pdffonts embedded Montserrat: %s\n' "${embedded_montserrat}"
printf '%s\n' "${PDF_PATH}"
