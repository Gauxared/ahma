#!/usr/bin/env python3
"""
Шаблон сборки Excel-файла smeta_aksonomia.xlsx.

Это РЕФЕРЕНСНЫЙ ШАБЛОН — копируй и адаптируй под конкретный проект.

Не запускай "как есть" — он демонстрирует структуру и принципы.
Реальная сборка делается под данные конкретного проекта.

ВХОД:
    parsed_lsr.json — результат парсинга PDF (см. parse_lsr_pdf.py)
    
ВЫХОД:
    smeta_aksonomia.xlsx — готовый Excel-файл с 11 листами

ТРЕБОВАНИЯ:
    pip install openpyxl --break-system-packages
"""
import json
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from collections import defaultdict
import re


# ─────────── ЦВЕТА И СТИЛИ ───────────
C_DARK = "1F4E78"
C_LIGHT_BLUE = "D9E1F2"
C_LIGHT_YELLOW = "FFE699"
C_LIGHT_GREEN = "C6EFCE"
C_LIGHT_RED = "FFC7CE"
C_LIGHT_GREY = "F2F2F2"
C_INPUT = "FFF2CC"

F_TITLE = Font(name='Arial', size=14, bold=True)
F_SUBTITLE = Font(name='Arial', size=11, bold=True)
F_HEADER = Font(name='Arial', size=10, bold=True, color='FFFFFF')
F_BOLD = Font(name='Arial', size=10, bold=True)
F_REGULAR = Font(name='Arial', size=10)
F_SMALL = Font(name='Arial', size=9)
F_INPUT = Font(name='Arial', size=10, color='0000FF', bold=True)
F_POSITIVE = Font(name='Arial', size=10, bold=True, color='006100')
F_NEGATIVE = Font(name='Arial', size=10, bold=True, color='9C0006')

FILL_HEADER = PatternFill('solid', start_color=C_DARK)
FILL_GROUP = PatternFill('solid', start_color=C_LIGHT_BLUE)
FILL_TOTAL = PatternFill('solid', start_color=C_LIGHT_YELLOW)
FILL_POSITIVE = PatternFill('solid', start_color=C_LIGHT_GREEN)
FILL_NEGATIVE = PatternFill('solid', start_color=C_LIGHT_RED)
FILL_INPUT = PatternFill('solid', start_color=C_INPUT)

ALIGN_CENTER = Alignment(horizontal='center', vertical='center', wrap_text=True)
ALIGN_LEFT = Alignment(horizontal='left', vertical='center', wrap_text=True)
ALIGN_RIGHT = Alignment(horizontal='right', vertical='center')

THIN = Side(border_style='thin', color='808080')
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

# Управляющая ячейка совокупного индекса
INDEX_CELL = "'Параметры_индексы'!$B$21"


def build_readme(wb):
    """Лист 1: README — навигация и итоговые цифры."""
    ws = wb.create_sheet('README', 0)
    
    ws['A1'] = "📋 СМЕТА, РЫНОК И ФИНРЕЗУЛЬТАТ ПРОЕКТА"
    ws['A1'].font = F_TITLE
    ws.merge_cells('A1:B1')
    
    rows = [
        ("", ""),
        ("📑 СТРУКТУРА ФАЙЛА (11 листов)", ""),
        ("README", "Этот лист — навигация"),
        ("Объект", "Реквизиты заказчика, сроки"),
        ("Параметры_индексы", "Индексы инфляции (B18 — управляющая ячейка)"),
        ("Смета_контракта", "Укрупнённая смета"),
        ("Свод_по_главам", "Итоги по главам ССР"),
        ("Себестоимость_итог ⭐", "ГЛАВНЫЙ ЛИСТ: финансовый результат"),
        ("ВОР_укрупненный", "Физические объёмы"),
        ("Свод_ЛСР", "Итоги по локальным сметам"),
        ("Ключевые_ресурсы ⭐", "Материалы с рыночными ценами"),
        ("Ключевые_работы ⭐", "Работы с коэф. рыночности"),
        ("Все_позиции ⭐", "Все строки из ЛСР с автофильтром"),
        ("", ""),
        ("💎 ФИНАНСОВЫЙ РЕЗУЛЬТАТ", ""),
        ("Сметная стоимость «под ключ»", "= Себестоимость_итог!E[ИТОГО]"),
        ("Прибыль на материалах", "= Ключевые_ресурсы!J114"),
        ("Прибыль на работах", "= Ключевые_работы!I[итог]"),
        ("💰 ОБЩАЯ ДОПОЛНИТЕЛЬНАЯ ПРИБЫЛЬ", "Сумма двух дельт"),
        ("", ""),
        ("⚙️ КАК МЕНЯТЬ", ""),
        ("Целевая дата расчёта", "Параметры_индексы!B18 (мес. от обоснования НМЦК)"),
        ("Рыночные цены материалов", "Ключевые_ресурсы!H (жёлтая колонка)"),
        ("Коэффициенты работ", "Ключевые_работы!G"),
    ]
    
    for i, (k, v) in enumerate(rows, start=3):
        ws.cell(row=i, column=1, value=k)
        ws.cell(row=i, column=2, value=v)
        if k and any(k.startswith(p) for p in ['📑','💎','⚙️']):
            ws.cell(row=i, column=1).font = F_SUBTITLE
            ws.cell(row=i, column=1).fill = FILL_GROUP
            ws.cell(row=i, column=2).fill = FILL_GROUP
        elif k:
            ws.cell(row=i, column=1).font = F_BOLD
    
    ws.column_dimensions['A'].width = 50
    ws.column_dimensions['B'].width = 70


def build_indices_sheet(wb, base_index, monthly_index, target_months):
    """Лист 3: Параметры_индексы — управляющий лист с индексами."""
    ws = wb.create_sheet('Параметры_индексы')
    
    ws['A1'] = "Параметры индексов инфляции для пересчёта цен"
    ws['A1'].font = F_TITLE
    ws.merge_cells('A1:B1')
    
    ws['A3'] = "Базис цен в ЛСР: 4 кв. 2000 г. (ФЕР-2001)"
    ws['A4'] = "Текущий уровень в ЛСР: 4 кв. 2023 г. (через индекс перевода Минстроя)"
    
    ws['A5'] = "Дата обоснования НМЦК"
    ws['B5'] = "фев. 2026"
    
    ws['A6'] = "Базовый прогнозный индекс на дату НМЦК"
    ws['B6'] = base_index  # например, 1.163741
    ws['B6'].number_format = '0.000000'
    
    ws['A7'] = "Ежемесячный прогнозный индекс"
    ws['B7'] = monthly_index  # например, 1.004472
    ws['B7'].number_format = '0.000000'
    
    ws['A17'] = "ЦЕЛЕВОЙ КВАРТАЛ РАСЧЁТА"
    ws['A17'].font = F_SUBTITLE
    ws['B17'] = "2 кв. 2026"  # текстовое описание
    
    ws['A18'] = "Месяцев от даты НМЦК до целевой ← УПРАВЛЯЮЩАЯ"
    ws['A18'].font = F_BOLD
    ws['B18'] = target_months  # 3 для 2 кв. 2026
    ws['B18'].fill = FILL_INPUT
    ws['B18'].font = F_INPUT
    
    ws['A21'] = "СОВОКУПНЫЙ ИНДЕКС (фев.2026 → целевой) ↓"
    ws['A21'].font = F_BOLD
    ws['B21'] = "=B6*POWER(B7,B18)"
    ws['B21'].number_format = '0.000000'
    ws['B21'].fill = FILL_TOTAL
    ws['B21'].font = F_BOLD
    
    ws['A23'] = "📌 Изменение ячейки B18 пересчитывает весь файл"
    ws['A23'].font = Font(italic=True, color='595959')
    
    ws.column_dimensions['A'].width = 60
    ws.column_dimensions['B'].width = 16


def build_key_materials_sheet(wb, materials_agg, market_prices):
    """Лист 9: Ключевые_ресурсы — материалы с рыночными ценами."""
    ws = wb.create_sheet('Ключевые_ресурсы')
    
    ws['A1'] = "🔑 Ключевые материалы — сметная и рыночная стоимость"
    ws['A1'].font = F_TITLE
    ws.merge_cells('A1:M1')
    
    headers = [
        "№", "Наименование материала", "Ед.изм.", "Кол-во",
        "Цена 4кв.2023", "Сметная цена 2кв.2026", "Сметная стоимость",
        "🟢 Рыночная цена", "Рыночная стоимость", "🟠 ДЕЛЬТА", "% дельта",
        "Источник цены", "Коэф. рынок/смета"
    ]
    for j, h in enumerate(headers, 1):
        c = ws.cell(row=5, column=j, value=h)
        c.font = F_HEADER
        c.fill = FILL_HEADER
        c.alignment = ALIGN_CENTER
        c.border = BORDER
    
    row = 6
    idx = 0
    
    # Сортируй по убыванию стоимости
    sorted_mats = sorted(materials_agg.items(), 
                         key=lambda x: x[1].get('cost_current_sum', 0) or 0,
                         reverse=True)
    
    for name, data in sorted_mats:
        if not data.get('qty_sum') or data['qty_sum'] <= 0:
            continue
        if not data.get('cost_current_sum'):
            continue
        
        idx += 1
        unit_price_current = data['cost_current_sum'] / data['qty_sum']
        
        ws.cell(row=row, column=1, value=idx).alignment = ALIGN_CENTER
        ws.cell(row=row, column=2, value=name).alignment = ALIGN_LEFT
        ws.cell(row=row, column=3, value=data.get('unit', '')).alignment = ALIGN_CENTER
        ws.cell(row=row, column=4, value=data['qty_sum']).number_format = '#,##0.00'
        ws.cell(row=row, column=5, value=unit_price_current).number_format = '#,##0.00'
        ws.cell(row=row, column=6, value=f"=E{row}*{INDEX_CELL}").number_format = '#,##0.00'
        ws.cell(row=row, column=7, value=f"=F{row}*D{row}").number_format = '#,##0.00'
        
        # H: рыночная цена (из словаря или для ввода)
        market = market_prices.get(name)
        if market:
            ws.cell(row=row, column=8, value=market[0]).number_format = '#,##0.00'
            ws.cell(row=row, column=12, value=market[2]).font = F_SMALL
        else:
            ws.cell(row=row, column=8).fill = FILL_INPUT
            ws.cell(row=row, column=8).font = F_INPUT
            ws.cell(row=row, column=12, value="ввести вручную").font = F_SMALL
        
        ws.cell(row=row, column=9, value=f'=IF(H{row}="","",H{row}*D{row})').number_format = '#,##0.00'
        ws.cell(row=row, column=10, value=f'=IF(H{row}="","",G{row}-I{row})').number_format = '#,##0.00;[Red]-#,##0.00'
        ws.cell(row=row, column=11, value=f'=IF(OR(H{row}="",I{row}=0),"",J{row}/I{row})').number_format = '0.0%;[Red]-0.0%'
        ws.cell(row=row, column=13, value=f'=IF(OR(F{row}=0,H{row}=""),"",H{row}/F{row})').number_format = '0.000'
        
        for c in range(1, 14):
            ws.cell(row=row, column=c).border = BORDER
            if c not in [8, 10, 11]:
                ws.cell(row=row, column=c).font = F_REGULAR
        
        row += 1
    
    # Итоги
    total_row = row + 1
    ws.cell(row=total_row, column=2, value="🎯 ИТОГО по всем материалам")
    ws.cell(row=total_row, column=7, value=f'=SUMIFS(G6:G{row-1},A6:A{row-1},">0",H6:H{row-1},">0")')
    ws.cell(row=total_row, column=9, value=f'=SUMIFS(I6:I{row-1},A6:A{row-1},">0",H6:H{row-1},">0")')
    ws.cell(row=total_row, column=10, value=f'=SUMIFS(J6:J{row-1},A6:A{row-1},">0",H6:H{row-1},">0")')
    for c in range(1, 14):
        cell = ws.cell(row=total_row, column=c)
        cell.font = F_BOLD
        cell.fill = FILL_TOTAL
        cell.border = BORDER
        if c in [7, 9, 10]:
            cell.number_format = '#,##0.00'
    
    # Ширины
    widths = [5, 50, 10, 13, 13, 14, 16, 13, 16, 16, 9, 30, 12]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[5].height = 60
    ws.freeze_panes = 'C6'


def build_key_works_sheet(wb, works_by_prefix, coefficient_defaults):
    """Лист 10: Ключевые_работы — работы с коэф. рыночности."""
    ws = wb.create_sheet('Ключевые_работы')
    
    ws['A1'] = "🔨 Ключевые группы работ — сметная и рыночная стоимость"
    ws['A1'].font = F_TITLE
    ws.merge_cells('A1:I1')
    
    headers = [
        "№", "Префикс кода", "Группа работ", "Кол-во расценок",
        "Сметная 4кв.23", "Сметная 2кв.26", "🟢 Коэф. рыночности",
        "Рыночная 2кв.26", "🟠 ДЕЛЬТА"
    ]
    for j, h in enumerate(headers, 1):
        c = ws.cell(row=5, column=j, value=h)
        c.font = F_HEADER
        c.fill = FILL_HEADER
        c.alignment = ALIGN_CENTER
        c.border = BORDER
    
    row = 6
    
    # Сортировка по убыванию стоимости
    sorted_groups = sorted(works_by_prefix.items(),
                           key=lambda x: x[1].get('cost_sum', 0),
                           reverse=True)
    
    for i, (prefix, data) in enumerate(sorted_groups, 1):
        coef_info = coefficient_defaults.get(prefix, {})
        coef = coef_info.get('coef', 0.85)
        group_name = coef_info.get('group_name', f"Прочие работы (код {prefix})")
        
        ws.cell(row=row, column=1, value=i).alignment = ALIGN_CENTER
        ws.cell(row=row, column=2, value=prefix).alignment = ALIGN_CENTER
        ws.cell(row=row, column=3, value=group_name).alignment = ALIGN_LEFT
        ws.cell(row=row, column=4, value=data.get('count', 0)).alignment = ALIGN_CENTER
        ws.cell(row=row, column=5, value=data.get('cost_sum', 0)).number_format = '#,##0.00'
        ws.cell(row=row, column=6, value=f"=E{row}*{INDEX_CELL}").number_format = '#,##0.00'
        ws.cell(row=row, column=7, value=coef).number_format = '0.00'
        ws.cell(row=row, column=7).fill = FILL_INPUT
        ws.cell(row=row, column=8, value=f"=F{row}*G{row}").number_format = '#,##0.00'
        ws.cell(row=row, column=9, value=f"=F{row}-H{row}").number_format = '#,##0.00;[Red]-#,##0.00'
        
        for c in range(1, 10):
            ws.cell(row=row, column=c).border = BORDER
            ws.cell(row=row, column=c).font = F_REGULAR
        
        # Покраска заработка
        ws.cell(row=row, column=9).fill = FILL_POSITIVE
        ws.cell(row=row, column=9).font = F_POSITIVE
        
        row += 1
    
    # ИТОГО
    total_row = row
    ws.cell(row=total_row, column=3, value="🎯 ИТОГО по всем работам")
    ws.cell(row=total_row, column=5, value=f"=SUM(E6:E{row-1})").number_format = '#,##0.00'
    ws.cell(row=total_row, column=6, value=f"=SUM(F6:F{row-1})").number_format = '#,##0.00'
    ws.cell(row=total_row, column=8, value=f"=SUM(H6:H{row-1})").number_format = '#,##0.00'
    ws.cell(row=total_row, column=9, value=f"=SUM(I6:I{row-1})").number_format = '#,##0.00;[Red]-#,##0.00'
    for c in range(1, 10):
        cell = ws.cell(row=total_row, column=c)
        cell.font = F_BOLD
        cell.fill = FILL_TOTAL
        cell.border = BORDER
    
    widths = [5, 12, 50, 11, 16, 16, 12, 16, 18]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = 'D6'


def build_excel_template(parsed_data, market_prices=None, coefficient_defaults=None,
                          base_index=1.163741, monthly_index=1.004472, target_months=3,
                          output_path='smeta_aksonomia.xlsx'):
    """
    Главная функция сборки Excel-файла.
    
    ПАРАМЕТРЫ:
        parsed_data: результат парсинга PDF (см. parse_lsr_pdf.py)
        market_prices: словарь {наименование: (цена, ед_изм, источник)}
        coefficient_defaults: словарь {префикс_кода: {coef, group_name}}
        base_index, monthly_index, target_months: параметры индекса
        output_path: путь для сохранения
    """
    wb = Workbook()
    
    # Удалить дефолтный лист
    if 'Sheet' in wb.sheetnames:
        del wb['Sheet']
    
    # README
    build_readme(wb)
    
    # Объект
    ws = wb.create_sheet('Объект')
    ws['A1'] = "Метаданные объекта — заполняется вручную"
    ws.column_dimensions['A'].width = 40
    ws.column_dimensions['B'].width = 50
    
    # Параметры_индексы
    build_indices_sheet(wb, base_index, monthly_index, target_months)
    
    # Здесь — другие листы (Смета_контракта, Свод_по_главам, Свод_ЛСР, ВОР_укрупненный)
    # Опускаю для краткости — их структура зависит от исходных данных
    for sheet_name in ['Смета_контракта', 'Свод_по_главам', 'ВОР_укрупненный', 'Свод_ЛСР']:
        ws = wb.create_sheet(sheet_name)
        ws['A1'] = f"Лист {sheet_name} — заполнить данными из исходных документов"
    
    # Себестоимость_итог (минимальный шаблон — см. references/excel-structure.md)
    ws = wb.create_sheet('Себестоимость_итог')
    ws['A1'] = "💰 ИТОГОВАЯ СЕБЕСТОИМОСТЬ И ФИНРЕЗУЛЬТАТ"
    ws['A1'].font = F_TITLE
    
    # Ключевые_ресурсы
    if market_prices is None:
        market_prices = {}
    
    # Агрегация материалов
    materials_agg = defaultdict(lambda: {'unit': '', 'qty_sum': 0, 'cost_current_sum': 0})
    for p in parsed_data.get('positions', []):
        if p['type'] != 'material':
            continue
        name = p.get('name', '').strip()[:80]
        if not name:
            continue
        materials_agg[name]['unit'] = p.get('unit') or ''
        materials_agg[name]['qty_sum'] += p.get('qty') or 0
        materials_agg[name]['cost_current_sum'] += p.get('cost_current') or 0
    
    build_key_materials_sheet(wb, dict(materials_agg), market_prices)
    
    # Ключевые_работы
    if coefficient_defaults is None:
        # Загрузи из assets если не передано
        coefficient_defaults = {}
    
    works_by_prefix = defaultdict(lambda: {'count': 0, 'cost_sum': 0})
    for p in parsed_data.get('positions', []):
        if p['type'] != 'work':
            continue
        code = p.get('code_num', '')
        m = re.match(r'^(\d{2}-\d{2})', code)
        if m:
            prefix = m.group(1)
            works_by_prefix[prefix]['count'] += 1
            works_by_prefix[prefix]['cost_sum'] += p.get('cost_current') or 0
    
    build_key_works_sheet(wb, dict(works_by_prefix), coefficient_defaults)
    
    # Все_позиции
    ws = wb.create_sheet('Все_позиции')
    ws['A1'] = "Все позиции из ЛСР — заполняется автоматически"
    
    # Сохрани
    wb.save(output_path)
    print(f"✓ Файл сохранён: {output_path}")
    print(f"  Прочти references/excel-structure.md для полного шаблона.")


if __name__ == '__main__':
    import sys
    
    if len(sys.argv) < 2:
        print("Использование: python3 build_excel.py <parsed_lsr.json> [output.xlsx]")
        sys.exit(1)
    
    with open(sys.argv[1]) as f:
        parsed = json.load(f)
    
    output = sys.argv[2] if len(sys.argv) > 2 else 'smeta_aksonomia.xlsx'
    
    # Загрузи коэффициенты по умолчанию (если есть рядом)
    coef_path = '../assets/coefficient_defaults.json'
    coefs = {}
    try:
        with open(coef_path) as f:
            coefs = json.load(f)
    except FileNotFoundError:
        print(f"⚠ Файл коэффициентов не найден: {coef_path}")
        print(f"  Будут использованы значения по умолчанию (0.85 для всех)")
    
    build_excel_template(parsed, coefficient_defaults=coefs, output_path=output)
    print(f"\n⚠️ Это РЕФЕРЕНСНЫЙ ШАБЛОН. Для production-сборки используй полный код,")
    print(f"   адаптированный под конкретные данные проекта.")
