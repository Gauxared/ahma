"""Доставка страниц: браузер lightpanda через CDP для сайтов с JavaScript, иначе
обычный запрос scrapling. Прокси — `STROYINTELLECT_SEARCH_PROXY` (sing-box сервера).

Выбор канала — свойство источника (см. `sources.py`), не догадка на месте:
pulscen проверяет JavaScript и отдаёт 503 обычному клиенту, tradedir — нет.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"


@dataclass(frozen=True)
class Page:
    url: str
    status: int
    html: str
    channel: str


def cdp_url() -> str | None:
    return os.environ.get("STROYINTELLECT_CDP_URL") or None


def proxy_url() -> str | None:
    return os.environ.get("STROYINTELLECT_SEARCH_PROXY") or None


def fetch_static(url: str, *, via_proxy: bool = False, timeout: int = 30) -> Page:
    """Обычный HTTP-запрос браузерным отпечатком (scrapling Fetcher, curl_cffi)."""
    from scrapling.fetchers import Fetcher

    kwargs: dict = {"timeout": timeout, "headers": {"Accept-Language": "ru-RU,ru;q=0.9"}, "impersonate": "chrome"}
    proxy = proxy_url() if via_proxy else None
    if proxy:
        kwargs["proxy"] = proxy
    response = Fetcher.get(url, **kwargs)
    return Page(url=url, status=int(response.status), html=response.body.decode("utf-8", "replace") if isinstance(response.body, bytes) else str(response.body), channel="прямой запрос" + (" через прокси" if proxy else ""))


CHALLENGE = ("Проверка безопасности", "Checking your browser", "challenge-platform", "cf-chl")


def _challenged(status: int, body: str) -> bool:
    return status in (403, 429, 503) or any(mark in body[:20_000] for mark in CHALLENGE)


def fetch_lightpanda(url: str, *, timeout_ms: int = 60_000) -> Page:
    """Страница, отрисованная браузером lightpanda (CDP). Без `STROYINTELLECT_CDP_URL` — ошибка словом."""
    ws = cdp_url()
    if ws is None:
        raise RuntimeError("браузер не настроен: задайте STROYINTELLECT_CDP_URL (ws://127.0.0.1:9222 — lightpanda serve)")
    from scrapling.fetchers import DynamicFetcher

    page = DynamicFetcher.fetch(url, cdp_url=ws, network_idle=False, timeout=timeout_ms)
    body = page.body.decode("utf-8", "replace") if isinstance(page.body, bytes) else str(page.body)
    return Page(url=url, status=int(page.status), html=body, channel="браузер lightpanda")


def fetch_stealth(url: str, *, timeout_ms: int = 90_000) -> Page:
    """Второй браузер — скрытный Chromium (scrapling StealthyFetcher на patchright): проходит проверку безопасности, которую lightpanda не проходит.

    Замер 08.09.2026: pulscen после первого успеха lightpanda стал отдавать 503
    «Проверка безопасности» и напрямую, и через прокси; этот канал открыл 200 с
    40 карточками.

    НЕ CAMOUFOX, хотя так было написано сначала. В scrapling 0.4.15 слова
    «camoufox» нет ни в одном файле: `StealthyFetcher` — это Chromium под
    patchright. Имя в `channel` читает человек, разбирающий, откуда взялась
    цена, и неверное имя посылает его искать не тот браузер.

    Браузер ставится один раз командой `scrapling install` (она тянет chromium
    для playwright/patchright); на сервере уже стоит.
    """
    from scrapling.fetchers import StealthyFetcher

    page = StealthyFetcher.fetch(url, headless=True, network_idle=True, timeout=timeout_ms, solve_cloudflare=False)
    body = page.body.decode("utf-8", "replace") if isinstance(page.body, bytes) else str(page.body)
    return Page(url=url, status=int(page.status), html=body, channel="браузер chromium скрытный")


def fetch_browser(url: str) -> Page:
    """lightpanda первым (лёгкий, 2 с на страницу); проверка безопасности или отказ — скрытный Chromium."""
    first: Page | None = None
    try:
        first = fetch_lightpanda(url)
        if not _challenged(first.status, first.html):
            return first
    except Exception as error:  # noqa: BLE001 — переходим ко второму браузеру, причину сохраняем
        first = Page(url=url, status=0, html=str(error), channel="браузер lightpanda: ошибка")
    try:
        second = fetch_stealth(url)
        return Page(url=url, status=second.status, html=second.html, channel=f"{second.channel} (lightpanda: {first.status or first.html[:80]})")
    except Exception as error:  # noqa: BLE001
        return Page(url=url, status=first.status, html=first.html, channel=f"{first.channel}; скрытный chromium: {str(error)[:120]}")


def fetch(url: str, *, browser: bool) -> Page:
    """Канал по свойству источника; статический канал повторяет через прокси при 403/429/5xx."""
    if browser:
        return fetch_browser(url)
    page = fetch_static(url)
    if page.status >= 400 and proxy_url():
        retry = fetch_static(url, via_proxy=True)
        if retry.status < page.status:
            return retry
    return page
