"""Реестр авторитетных источников: имя → как ходить и чем разбирать.

`browser=True` — страница проверяет JavaScript (pulscen отдаёт 503 обычному
клиенту) и читается только браузером lightpanda. Список пополняется по
инвентаризации легаси (docs/легаси-инвентаризация*.md): источники, названные в
промптах и опорных базах ролей, — в первую очередь.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from . import SourceReport


@dataclass(frozen=True)
class Source:
    name: str
    title: str
    kind: str
    browser: bool
    run: Callable[[str, str], SourceReport]
    what: str


def registry() -> dict[str, Source]:
    from . import pulscen

    sources = [
        Source(
            name="pulscen",
            title="Пульс цен (pulscen.ru) — B2B-площадка прайсов поставщиков",
            kind="площадка B2B",
            browser=True,
            run=pulscen.search,
            what="товар, цена «от», единица, поставщик, город; регион — поддомен",
        ),
    ]
    return {s.name: s for s in sources}
