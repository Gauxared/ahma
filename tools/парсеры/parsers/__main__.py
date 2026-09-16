"""`python -m parsers <источник> <запрос> [--регион <Регион>] [--json]` и `python -m parsers список`."""

from __future__ import annotations

import json
import sys

from .sources import registry


def usage() -> int:
    print("парсеры источников:", file=sys.stderr)
    print("  список                                — имена источников и что они дают", file=sys.stderr)
    print("  <источник> <запрос> [--регион <Регион>] [--json]", file=sys.stderr)
    return 2


def main(argv: list[str]) -> int:
    if not argv:
        return usage()
    command, *rest = argv
    sources = registry()

    if command in ("список", "list"):
        for s in sources.values():
            print(f"{s.name:12} {s.title} · {s.kind} · {'браузер' if s.browser else 'запрос'} · {s.what}")
        return 0

    source = sources.get(command)
    if source is None:
        print(f"нет источника «{command}»; доступны: {', '.join(sources)}", file=sys.stderr)
        return 2

    region = "Россия"
    as_json = "--json" in rest
    words: list[str] = []
    it = iter([a for a in rest if a != "--json"])
    for arg in it:
        if arg == "--регион":
            region = next(it, region)
        else:
            words.append(arg)
    query = " ".join(words).strip()
    if not query:
        return usage()

    report = source.run(query, region)
    print(f"ИСТОЧНИК {source.title} · «{query}» · регион {region} · {report.status} · {report.url}")
    if report.offers:
        print("  наименование | цена | продавец | город | пометка | url")
        for o in report.offers[:40]:
            print(f"  {o.name} | {o.price} | {o.seller or '—'} | {o.city or '—'} | {o.note or '✅'} | {o.url}")
    if report.notes:
        print("НЕ ОТВЕТИЛО: " + "; ".join(report.notes))
    if not report.offers:
        print("Цен не найдено: в листе — «источник недоступен: <заметка выше>», ориентир — из навыка construction-cost-analysis со статусом ⚠.")
    print("Каждая цифра в лист — с тегом [ИСТОЧНИК: <url карточки>, <дата>, ✅/⚠]; «вне региона» — только ⚠ без доставки.")
    if as_json:
        print(json.dumps(report.as_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
