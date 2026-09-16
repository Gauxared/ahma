"""Разбор карточек Пульса цен на странице, снятой браузером lightpanda 08.09.2026."""

from pathlib import Path

from parsers import pulscen

FIXTURE = Path(__file__).parent / "fixtures" / "pulscen-bitum.html"


def test_parses_all_cards_with_price_seller_city():
    offers = pulscen.parse(FIXTURE.read_text(encoding="utf-8"), region="Дагестан")

    assert len(offers) == 40
    first = next(o for o in offers if o.seller == "Торговый Дом Сатурн")
    assert first.name == "Битум строительный БНД 70/100 ГОСТ 33133-2014"
    assert first.price == "от 59 руб./кг"
    assert first.unit == "кг"
    assert first.city == "Ростов-на-Дону"
    assert first.url.startswith("https://rostov.pulscen.ru/products/")
    assert first.note == "вне региона"


def test_region_host_and_unknown_region_fall_back_to_federal():
    assert pulscen.search_url("битум", "Дагестан") == "https://www.pulscen.ru/search/price?q=%D0%B1%D0%B8%D1%82%D1%83%D0%BC"
    assert pulscen.search_url("битум", "Луна").startswith("https://www.pulscen.ru/search/price?q=")


def test_offers_in_region_come_first():
    html = FIXTURE.read_text(encoding="utf-8").replace("Ростов-на-Дону", "Махачкала")
    offers = pulscen.parse(html, region="Дагестан")
    in_region = [o for o in offers if o.note == ""]
    assert in_region, "продавец из Махачкалы должен считаться «в регионе»"
    assert all(o.city == "Махачкала" for o in in_region)
    assert len(in_region) < len(offers)
