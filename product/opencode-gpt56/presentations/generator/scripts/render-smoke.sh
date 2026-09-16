#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${ROOT_DIR}/output"
PROFILE_DIR="${ROOT_DIR}/.libreoffice/profile"
PPTX_PATH="${OUTPUT_DIR}/7kl-smoke.pptx"
PDF_PATH="${OUTPUT_DIR}/7kl-smoke.pdf"

fail() {
  printf 'render-smoke: %s\n' "$1" >&2
  exit 1
}

required_commands=(node libreoffice fc-match pdfinfo pdffonts)
for required_command in "${required_commands[@]}"; do
  command -v "${required_command}" >/dev/null 2>&1 \
    || fail "missing required command: ${required_command}"
done

mkdir -p "${OUTPUT_DIR}" "${PROFILE_DIR}" "${ROOT_DIR}/.cache/fontconfig"
rm -f "${PDF_PATH}"

export FONTCONFIG_FILE="${ROOT_DIR}/fontconfig/fonts.conf"
export XDG_CACHE_HOME="${ROOT_DIR}/.cache"

resolved_font_path="$(fc-match --format='%{file}' 'Montserrat')"
case "${resolved_font_path}" in
  "${ROOT_DIR}/assets/fonts/"*) ;;
  *) fail "Montserrat resolved outside generator assets: ${resolved_font_path:-not found}" ;;
esac

node "${ROOT_DIR}/src/smoke.mjs"

libreoffice \
  --headless \
  --nologo \
  --nodefault \
  --nofirststartwizard \
  "-env:UserInstallation=file://${PROFILE_DIR}" \
  --convert-to pdf \
  --outdir "${OUTPUT_DIR}" \
  "${PPTX_PATH}"

test -s "${PDF_PATH}"
page_count=""
while IFS=: read -r key value; do
  if [[ "${key}" == "Pages" ]]; then
    page_count="${value//[[:space:]]/}"
  fi
done < <(pdfinfo "${PDF_PATH}")
[[ "${page_count}" == "1" ]] || fail "expected exactly one PDF page, got: ${page_count:-unknown}"

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
printf 'pdfinfo pages: %s\n' "${page_count}"
printf 'pdffonts embedded Montserrat: %s\n' "${embedded_montserrat}"
printf '%s\n' "${PDF_PATH}"
