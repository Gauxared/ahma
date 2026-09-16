"""Пульс цен — карточки `product-listing__item` на странице категории.

Разметка снята браузером 08.09.2026 (tests/fixtures/pulscen-bitum.html):
заголовок `product-listing__product-title` (внутри ссылка на поддомен города:
rostov.pulscen.ru, perm.pulscen.ru), цена `product-listing__price` — `<span
data-price-type="from">59</span><span class="price-currency"> руб./кг</span>`,
поставщик — `title` у `product-listing__company-name-wrapper`, город — один из
`product-listing__company-info-item`. Регион запроса — поддомен площадки
(`makhachkala.pulscen.ru`), но выдача включает продавцов из других городов, поэтому
город продавца берётся из его карточки, а не из адреса.
"""

from __future__ import annotations

import html
import re
from urllib.parse import quote_plus

from . import Offer, SourceReport
from .fetch import fetch

REGION_HOSTS = {
    "дагестан": "makhachkala",
    "махачкала": "makhachkala",
    "москва": "www",
    "московская область": "www",
    "санкт-петербург": "spb",
    "свердловская область": "ekb",
    "екатеринбург": "ekb",
    "челябинская область": "chelyabinsk",
    "татарстан": "kazan",
    "самарская область": "samara",
    "краснодарский край": "krasnodar",
    "калининградская область": "kaliningrad",
    "курганская область": "kurgan",
    "марий эл": "yoshkar-ola",
    "хабаровский край": "khabarovsk",
}

REGION_CITIES = {
    "дагестан": {"махачкала", "каспийск", "дербент", "хасавюрт", "буйнакск", "кизляр", "избербаш"},
}

_TAG = re.compile(r"<[^>]+>")


def _text(fragment: str) -> str:
    return html.unescape(re.sub(r"\s+", " ", _TAG.sub(" ", fragment))).strip()


def search_url(query: str, region: str) -> str:
    # Поиск живёт только на www: региональные поддомены на /search отвечают 404
    # (замер 08.09.2026), поэтому регион — не адрес, а город продавца в карточке.
    return f"https://www.pulscen.ru/search/price?q={quote_plus(query)}"


def parse(page_html: str, region: str = "") -> list[Offer]:
    offers: list[Offer] = []
    starts = [m.start() for m in re.finditer(r'class="\s*product-listing__item\s', page_html)]
    starts.append(len(page_html))
    region_cities = REGION_CITIES.get(region.strip().lower(), set())
    for a, b in zip(starts, starts[1:]):
        block = page_html[a:b]
        title = re.search(r'product-listing__product-title[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)</a>', block)
        if title is None:
            continue
        amount = re.search(r'data-price-type="([a-z]+)"[^>]*>([^<]+)<', block)
        currency = re.search(r'class="price-currency">([^<]*)<', block)
        company = re.search(r'product-listing__company-name-wrapper[^>]*title="([^"]+)"', block)
        # Поля карточки поставщика: первое — имя компании (вложенный блок), дальше
        # «Онлайн», город, телефон. Город — текстовое поле без компании и телефона.
        info = [
            _text(m)
            for m in re.findall(r'class="product-listing__company-info-item"[^>]*>([\s\S]*?)</li>', block)
            if "company-name" not in m
        ]
        city = next((i for i in info if i and i != "Онлайн" and "показать" not in i and not i.startswith("+7")), "")
        unit = _text(currency.group(1)) if currency else ""
        price = "цена по запросу"
        if amount is not None:
            prefix = "от " if amount.group(1) == "from" else ""
            price = f"{prefix}{_text(amount.group(2))} {unit}".strip()
        note = ""
        if region_cities and city.lower() not in region_cities:
            note = "вне региона"
        offers.append(
            Offer(
                name=_text(title.group(2)),
                price=price,
                unit=unit.replace("руб./", "").strip() or "",
                seller=html.unescape(company.group(1)) if company else "",
                city=city,
                url=title.group(1),
                date="",
                source="pulscen",
                note=note,
            )
        )
    return offers


def search(query: str, region: str) -> SourceReport:
    url = search_url(query, region)
    report = SourceReport(source="pulscen", query=query, region=region, url=url, status="")
    try:
        page = fetch(url, browser=True)
    except Exception as error:  # noqa: BLE001 — отказ источника называется словом
        report.status = f"недоступен: {error}"
        return report
    report.status = f"HTTP {page.status} · {page.channel}"
    if page.status != 200:
        report.notes.append("страница не открылась")
        return report
    report.offers = parse(page.html, region)
    if not report.offers:
        report.notes.append("карточек не разобрано — разметка изменилась или выдача пуста")
    report.offers.sort(key=lambda o: o.note != "")
    return report
