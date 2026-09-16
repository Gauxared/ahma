---
title: "Calc Engine"
date_created: 2026-08-05
type: spec
status: superseded
superseded_by: docs/architecture_v3.md
layer: backend
scope: calc-engine
project: stroyintellekt
source: docs/architecture_optimal2.md §4.3, reference-system/apri/...txt Часть 4
---

# 04. Calc Engine

## 1. Назначение

Calc Engine — набор детерминированных расчётных функций, зарегистрированных как Codex Tools. Агент вызывает их через `tool_call`, получает точный результат на `Decimal`. LLM **не считает арифметику** — Calc Engine считает.

## 2. Принципы

1. **Decimal everywhere.** Все суммы, ставки, объёмы — `Decimal`. Никогда `float`
2. **Trace.** Каждый расчёт возвращает `calculation_trace` — цепочку формул с промежуточными значениями
3. **Rounding.** Рубли — до копеек (2 знака). ₽/м² — до рублей (0 знаков). Проценты — 2 знака
4. **Source required.** Каждый входной параметр маркируется: `fact` / `assumption` / `unknown`
5. **No hardcoded values.** Ставки, коэффициенты, пороги — из конфигурации или опорной базы

## 3. Формулы (из Части 4 промпта)

### 3.1 calc_convergence

**Проверка сходимости:** сумма разделов ЛСР = итог свода. Δ ≠ 0 = 🔴.

```python
def calc_convergence(sections: list[str], total: str) -> dict:
    """
    sections: ["2250000.00", "4800000.00", ...]
    total: "48350000.00"
    """
    sections_sum = sum(Decimal(s) for s in sections)
    doc_total = Decimal(total)
    delta = sections_sum - doc_total
    
    return {
        "sections_sum": str(sections_sum),
        "document_total": str(doc_total),
        "delta": str(delta),
        "delta_pct": str((delta / doc_total * 100).quantize(Decimal("0.01"))) if doc_total else "0",
        "status": "ok" if delta == 0 else "error",
        "marker": "✅" if delta == 0 else "🔴",
        "trace": f"Σ разделов = {sections_sum} | Итог документа = {doc_total} | Δ = {delta}"
    }
```

### 3.2 calc_cost_per_sqm

**Себестоимость ₽/м²** по слоям:

```python
def calc_cost_per_sqm(
    land: str,           # земля
    smr: str,            # СМР
    networks: str,       # сети
    design: str,         # проектирование
    ahr: str,            # АХР
    pf_interest: str,    # проценты ПФ
    total_sqm: str,      # общая площадь м²
) -> dict:
    components = {
        "land": Decimal(land),
        "smr": Decimal(smr),
        "networks": Decimal(networks),
        "design": Decimal(design),
        "ahr": Decimal(ahr),
        "pf_interest": Decimal(pf_interest),
    }
    total = sum(components.values())
    sqm = Decimal(total_sqm)
    per_sqm = (total / sqm).quantize(Decimal("1"))
    
    return {
        "total_cost": str(total),
        "total_sqm": str(sqm),
        "cost_per_sqm": str(per_sqm),
        "breakdown": {k: str(v) for k, v in components.items()},
        "breakdown_per_sqm": {
            k: str((v / sqm).quantize(Decimal("1")))
            for k, v in components.items()
        },
        "trace": f"Σ = {total} ₽ / {sqm} м² = {per_sqm} ₽/м²"
    }
```

### 3.3 calc_project_finance

**Финмодель проекта под эскроу/ПФ:** маржа, БДДС, дата разрыва, проценты ПФ.

```python
def calc_project_finance(
    budget_smr: str,            # бюджет СМР
    duration_months: int,       # срок стройки
    pf_rate: str,               # ставка ПФ годовая (0.23)
    advance_pct: str,           # % аванса (0.25)
    gu_pct: str,                # % ГУ (0.05)
    escrow_opening_month: int,  # месяц ввода → раскрытие эскроу
) -> dict:
    budget = Decimal(budget_smr)
    rate = Decimal(pf_rate)
    advance = Decimal(advance_pct)
    gu = Decimal(gu_pct)
    
    # Проценты ПФ = ставка × средний остаток × срок
    monthly_rate = rate / 12
    avg_balance = budget * Decimal("0.5")  # упрощённо
    pf_interest = (avg_balance * monthly_rate * duration_months).quantize(Decimal("0.01"))
    
    # ГУ замороженные
    gu_amount = (budget * gu).quantize(Decimal("0.01"))
    
    # Аванс = ранняя выборка
    advance_amount = (budget * advance).quantize(Decimal("0.01"))
    
    # БДДС помесячно (линейное распределение)
    monthly_spend = (budget / duration_months).quantize(Decimal("0.01"))
    
    return {
        "budget_smr": str(budget),
        "duration_months": duration_months,
        "pf_rate": str(rate),
        "pf_interest_total": str(pf_interest),
        "gu_amount": str(gu_amount),
        "advance_amount": str(advance_amount),
        "monthly_spend": str(monthly_spend),
        "escrow_opening_month": escrow_opening_month,
        "scenarios": {
            "base": {"margin_pct": "calculated", "pf_interest": str(pf_interest)},
            "stress_plus_3m": {"note": "+3 мес ввода = +проценты ПФ"},
            "optimism": {"note": "−1 мес = экономия на процентах"},
        },
        "trace": f"ПФ: {avg_balance} × {monthly_rate}/мес × {duration_months} мес = {pf_interest} ₽"
    }
```

### 3.4 calc_deviation

**Отклонение цены подрядчика от рынка/опорной базы:**

```python
def calc_deviation(
    contractor_price: str,   # цена подрядчика за единицу
    reference_price: str,    # цена опорной базы
    volume: str,             # объём
    unit: str,               # единица измерения
) -> dict:
    cp = Decimal(contractor_price)
    rp = Decimal(reference_price)
    vol = Decimal(volume)
    
    delta_unit = cp - rp
    delta_pct = ((delta_unit / rp) * 100).quantize(Decimal("0.01")) if rp else Decimal("0")
    delta_total = (delta_unit * vol).quantize(Decimal("0.01"))
    
    marker = "✅" if abs(delta_pct) <= 5 else ("⚠" if abs(delta_pct) <= 15 else "🔴")
    
    return {
        "contractor_price": str(cp),
        "reference_price": str(rp),
        "volume": str(vol),
        "unit": unit,
        "delta_per_unit": str(delta_unit),
        "delta_pct": str(delta_pct),
        "delta_total": str(delta_total),
        "marker": marker,
        "trace": f"{cp} − {rp} = {delta_unit} ₽/{unit} ({delta_pct}%) × {vol} = {delta_total} ₽"
    }
```

### 3.5 calc_gu_vs_bg

**ГУ 5% vs БГ:** экономия = ГУ × стоимость денег − стоимость БГ.

```python
def calc_gu_vs_bg(
    contract_sum: str,       # сумма контракта
    gu_pct: str,             # % ГУ (0.05)
    bg_annual_pct: str,      # стоимость БГ годовая (0.015)
    duration_years: str,     # срок в годах
) -> dict:
    cs = Decimal(contract_sum)
    gu_rate = Decimal(gu_pct)
    bg_rate = Decimal(bg_annual_pct)
    years = Decimal(duration_years)
    
    gu_amount = (cs * gu_rate).quantize(Decimal("0.01"))
    bg_cost = (cs * gu_rate * bg_rate * years).quantize(Decimal("0.01"))
    savings = (gu_amount - bg_cost).quantize(Decimal("0.01"))
    
    return {
        "gu_amount": str(gu_amount),
        "bg_annual_cost": str(bg_cost),
        "savings_if_replace": str(savings),
        "recommendation": f"Замена ГУ на БГ = экономия {savings} ₽",
        "trace": f"ГУ = {cs} × {gu_rate} = {gu_amount} | БГ = {gu_amount} × {bg_rate} × {years} = {bg_cost} | Δ = {savings}"
    }
```

### 3.6–3.10 Остальные формулы

| # | Функция | Формула | Входы |
|---|---------|---------|-------|
| 3.6 | `calc_bdds` | БДДС помесячно: доходы − расходы − обслуживание долга | budget, income_schedule, pf_rate, months |
| 3.7 | `calc_advance_effect` | Аванс → ранняя выборка кредита → дополнительные проценты | advance_pct, budget, pf_rate |
| 3.8 | `calc_timeline_shift` | +1 мес = +проценты ПФ + +косвенные. Стоимость каждого месяца | monthly_indirect, monthly_pf_interest |
| 3.9 | `calc_penalties` | Пени: 1/300 ключевой ставки × сумма × дни просрочки | amount, key_rate, days |
| 3.10 | `calc_margin` | Маржа проекта: 3 сценария (база/стресс/оптимизм) | revenue, cost_layers, scenarios |

## 4. Tool Schema Registration

Каждая функция регистрируется для Codex:

```python
# backend/app/tools/calc_tool.py

CALC_TOOLS = [
    {
        "name": "calc_convergence",
        "description": "Проверка сходимости: сумма ЛСР = свод до рубля. Δ≠0 = 🔴.",
        "parameters": {
            "type": "object",
            "properties": {
                "sections": {"type": "array", "items": {"type": "string"}},
                "total": {"type": "string"}
            },
            "required": ["sections", "total"]
        }
    },
    # ... ×10
]

CALC_FUNCTIONS = {
    "calc_convergence": calc_convergence,
    "calc_cost_per_sqm": calc_cost_per_sqm,
    "calc_project_finance": calc_project_finance,
    "calc_deviation": calc_deviation,
    "calc_gu_vs_bg": calc_gu_vs_bg,
    "calc_bdds": calc_bdds,
    "calc_advance_effect": calc_advance_effect,
    "calc_timeline_shift": calc_timeline_shift,
    "calc_penalties": calc_penalties,
    "calc_margin": calc_margin,
}
```

## 5. Unit Tests

Каждая формула покрывается ≥3 тестами:

```python
# backend/tests/test_calc_engine.py

def test_convergence_ok():
    result = calc_convergence(
        sections=["2250000.00", "4800000.00", "41300000.00"],
        total="48350000.00"
    )
    assert result["delta"] == "0.00"
    assert result["status"] == "ok"

def test_convergence_mismatch():
    result = calc_convergence(
        sections=["2250000.00", "4800000.00"],
        total="48350000.00"
    )
    assert result["status"] == "error"
    assert Decimal(result["delta"]) < 0

def test_deviation_within_threshold():
    result = calc_deviation("15500", "15200", "800", "м³")
    assert result["marker"] == "✅"  # <5%

def test_deviation_critical():
    result = calc_deviation("18500", "15200", "800", "м³")
    assert result["marker"] == "🔴"  # >15%

def test_gu_vs_bg():
    result = calc_gu_vs_bg("100000000", "0.05", "0.015", "2")
    assert Decimal(result["gu_amount"]) == Decimal("5000000.00")
    assert Decimal(result["savings_if_replace"]) > 0
```
