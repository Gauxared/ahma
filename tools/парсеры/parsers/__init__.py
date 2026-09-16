"""Парсеры авторитетных источников для листа market_check и нормативных справок.

Почему не поисковая выдача: прогоны 9–13 показали, что поисковики с адреса
сервера отдают CAPTCHA или подставную выдачу, а роли вписывали домены из
памяти. Здесь каждый источник — отдельный парсер с известной разметкой, а
страницы с проверкой JavaScript (pulscen) читаются через браузер lightpanda
по протоколу CDP (`STROYINTELLECT_CDP_URL`, на сервере ws://127.0.0.1:9222).

Каждый парсер возвращает список предложений одной формы (`Offer`): что, цена,
единица, продавец, город, url, дата, источник — и роль переносит строки в лист
с тегом [ИСТОЧНИК: url, дата, ✅/⚠]. Отказ источника — словом в `note`, не
пустая таблица.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass(frozen=True)
class Offer:
    name: str
    price: str
    unit: str
    seller: str
    city: str
    url: str
    date: str
    source: str
    note: str = ""

    def as_dict(self) -> dict[str, str]:
        return asdict(self)


@dataclass
class SourceReport:
    source: str
    query: str
    region: str
    url: str
    status: str
    offers: list[Offer] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "source": self.source,
            "query": self.query,
            "region": self.region,
            "url": self.url,
            "status": self.status,
            "offers": [o.as_dict() for o in self.offers],
            "notes": self.notes,
        }
