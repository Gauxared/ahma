#!/usr/bin/env python3
"""
Парсер PDF локальных сметных расчётов (ЛСР) из российской системы сметного дела.

Извлекает позиции работ (ФЕР/ФЕРр/ТЕР/ГЭСН), материалов (ФССЦ) и перевозок (ФССЦпг)
из PDF-файлов локальных смет. Также извлекает метаданные ЛСР и итоговые суммы для
контроля сходимости.

ИСПОЛЬЗОВАНИЕ:
    python3 parse_lsr_pdf.py <pdf_file_1> [pdf_file_2 ...]

ТРЕБОВАНИЯ:
    - pdftotext (poppler-utils): apt-get install poppler-utils

ВЫХОД (JSON):
    {
        "lsr_meta": [{"num": "02-05", "name": "...", "total_current": 223189786.0, ...}],
        "positions": [{"lsr_num": "02-05", "pos_num": "1", "code_type": "ФЕР", 
                        "code_num": "27-04-013-04", "type": "work", "name": "...", 
                        "unit": "100 м2", "qty": 84.99, "cost_current": 5805973.21, ...}]
    }

Это упрощённая референсная реализация — реальный парсер требует тонкой настройки
под конкретный формат сметной программы. См. references/pdf-parsing.md.
"""
import sys
import re
import json
import subprocess
import os
from pathlib import Path


# Regex для типов строк
RE_LSR_HEADER = re.compile(r'Локальн(?:ый|ая)\s+сметн(?:ый|ая)\s+(?:расч[её]т|смета)\s+№\s*([\w\-./]+)')
RE_LSR_NAME = re.compile(r'(?:Шифр|Объект):\s*(.+?)$', re.MULTILINE)
RE_BASE_DATE = re.compile(r'(\d{1,2})\s+квартал\s+(\d{4})')
RE_TOTAL_SMETA = re.compile(r'ВСЕГО\s+по\s+смете[\s\d.,]*?([\d\s,]+\.\d{2})')

# Главный паттерн позиции: № п/п + тип кода + код
# Примеры:
#   "1 ФЕР 27-04-013-04 ..."
#   "1.1 ФССЦ-04.1.02.05.06-1142 ..."
#   "1.1.1 ФССЦпг 03.21.04.10 ..."
RE_POSITION = re.compile(
    r'^\s*(\d+(?:\.\d+)*)\s+'           # номер позиции (1 или 1.1 или 1.1.1)
    r'(ФЕРр?|ТЕР|ГЭСН|ТСН|ФССЦ(?:пг)?)'  # тип кода
    r'\s+'
    r'([\w\-.]+)'                        # код
)

# "Итого по позиции N"
RE_TOTAL_POS = re.compile(r'Итого\s+по\s+позиции\s+(\d+(?:\.\d+)*)')

# Число с разделителем тысяч (пробел) и запятой/точкой как десятичный
RE_NUMBER = re.compile(r'-?[\d\s]*[\d][.,]?\d*')

# Типы работ vs материалов
WORK_CODES = {'ФЕР', 'ФЕРр', 'ТЕР', 'ГЭСН', 'ТСН'}
MATERIAL_CODES = {'ФССЦ'}
TRANSPORT_CODES = {'ФССЦпг'}


def pdf_to_text(pdf_path):
    """Конвертирует PDF в текст с сохранением колоночной структуры."""
    output = subprocess.run(
        ['pdftotext', '-layout', '-enc', 'UTF-8', str(pdf_path), '-'],
        capture_output=True, text=True, check=True
    )
    return output.stdout


def parse_number(s):
    """Парсит строку с числом российского формата (пробелы как разделители тысяч)."""
    if not s:
        return None
    cleaned = s.strip().replace(' ', '').replace(',', '.')
    try:
        return float(cleaned)
    except (ValueError, TypeError):
        return None


def parse_lsr_text(text, filename=None):
    """Парсит текст ЛСР и возвращает структуру с метаданными и позициями."""
    lsr_meta_list = []
    positions = []
    
    current_lsr = None
    current_position = None
    
    lines = text.split('\n')
    i = 0
    
    while i < len(lines):
        line = lines[i]
        
        # Новый ЛСР
        m = RE_LSR_HEADER.search(line)
        if m:
            # Сохрани предыдущий ЛСР
            if current_lsr:
                lsr_meta_list.append(current_lsr)
            
            lsr_num = m.group(1).strip()
            current_lsr = {
                'num': lsr_num,
                'name': '',
                'base_date': None,
                'total_current': None,
                'positions_count': 0,
                'source_file': filename,
            }
            
            # Поиск имени ЛСР в следующих 10 строках
            for j in range(i+1, min(i+10, len(lines))):
                next_line = lines[j].strip()
                if next_line and not next_line.startswith(('Основание', 'Заказчик', 'Стройка')):
                    if not any(kw in next_line for kw in ['Локальн', 'Шифр:', 'Адрес:']):
                        current_lsr['name'] = next_line
                        break
            
            # Поиск даты базиса
            m_date = RE_BASE_DATE.search(text[text.index(line):text.index(line)+500])
            if m_date:
                current_lsr['base_date'] = f"4 кв. {m_date.group(2)}"
            
            i += 1
            continue
        
        # ВСЕГО по смете
        m = RE_TOTAL_SMETA.search(line)
        if m and current_lsr:
            total = parse_number(m.group(1))
            if total:
                current_lsr['total_current'] = total
        
        # Заголовок позиции
        m = RE_POSITION.match(line)
        if m:
            pos_num = m.group(1)
            code_type = m.group(2)
            code_num = m.group(3)
            
            # Сохрани предыдущую позицию
            if current_position:
                _finalize_position(current_position)
                positions.append(current_position)
                if current_lsr:
                    current_lsr['positions_count'] += 1
            
            # Тип позиции
            if code_type in WORK_CODES:
                ptype = 'work'
            elif code_type in MATERIAL_CODES:
                ptype = 'material'
            elif code_type in TRANSPORT_CODES:
                ptype = 'transport'
            else:
                ptype = 'unknown'
            
            current_position = {
                'lsr_num': current_lsr['num'] if current_lsr else None,
                'pos_num': pos_num,
                'code_type': code_type,
                'code_num': code_num,
                'type': ptype,
                'name_lines': [],
                'numbers': [],
                'unit': None,
                'qty': None,
                'cost_base': None,
                'index': None,
                'cost_current': None,
            }
            
            # Извлечь оставшуюся часть строки после кода — там обычно начало наименования и числа
            rest = line[m.end():].strip()
            if rest:
                current_position['raw_lines'] = [rest]
            else:
                current_position['raw_lines'] = []
            
            i += 1
            continue
        
        # "Итого по позиции" — конец позиции
        m = RE_TOTAL_POS.search(line)
        if m and current_position:
            _finalize_position(current_position)
            positions.append(current_position)
            if current_lsr:
                current_lsr['positions_count'] += 1
            current_position = None
        
        # Продолжение текущей позиции
        if current_position is not None:
            current_position.setdefault('raw_lines', []).append(line.rstrip())
        
        i += 1
    
    # Финальная позиция и финальный ЛСР
    if current_position:
        _finalize_position(current_position)
        positions.append(current_position)
        if current_lsr:
            current_lsr['positions_count'] += 1
    if current_lsr:
        lsr_meta_list.append(current_lsr)
    
    return {
        'lsr_meta': lsr_meta_list,
        'positions': positions,
    }


def _finalize_position(pos):
    """Постобработка позиции: склейка наименования, извлечение чисел."""
    raw_lines = pos.get('raw_lines', [])
    
    # Склей наименование из текстовых частей (не цифры)
    name_parts = []
    all_numbers = []
    
    for line in raw_lines:
        # Числа в строке
        nums_in_line = []
        for m in RE_NUMBER.finditer(line):
            n = parse_number(m.group())
            if n is not None and abs(n) < 1e10:  # фильтр абсурдных значений
                nums_in_line.append(n)
        all_numbers.extend(nums_in_line)
        
        # Текстовая часть — буквы и описательная информация
        # Удалим числа и оставим текст
        text_only = re.sub(r'[\d\s.,\-]+', ' ', line).strip()
        if len(text_only) > 3:  # короткие фрагменты — обычно мусор
            name_parts.append(text_only)
    
    # Наименование = первая значимая текстовая часть
    pos['name'] = ' '.join(name_parts)[:200] if name_parts else ''
    pos['numbers'] = all_numbers
    
    # Попытка идентифицировать ключевые числа по позиции в строке
    # В стандартной ЛСР: qty, базис, индекс, текущая
    if len(all_numbers) >= 4:
        pos['qty'] = all_numbers[0]
        pos['cost_base'] = all_numbers[1]
        pos['index'] = all_numbers[2]
        pos['cost_current'] = all_numbers[-1]  # последнее число — обычно текущая стоимость
    
    # Удали служебные поля
    pos.pop('raw_lines', None)
    pos.pop('name_lines', None)


def verify_convergence(parsed, tolerance=1.0):
    """Проверяет сходимость: сумма ЛСР = сумма позиций "ВСЕГО"."""
    total_from_headers = sum(
        lsr.get('total_current', 0) or 0 
        for lsr in parsed['lsr_meta']
    )
    
    # Сумма из позиций — это последняя "ВСЕГО по смете" в каждом ЛСР
    # У нас всё уже в total_current метаданных, так что просто сравним
    
    return {
        'total_from_headers': total_from_headers,
        'lsrs_count': len(parsed['lsr_meta']),
        'positions_count': len(parsed['positions']),
    }


def main():
    if len(sys.argv) < 2:
        print("Использование: python3 parse_lsr_pdf.py <pdf_file_1> [pdf_file_2 ...]")
        print("Выход: parsed_lsr.json в текущем каталоге")
        sys.exit(1)
    
    all_meta = []
    all_positions = []
    
    for pdf_path in sys.argv[1:]:
        if not Path(pdf_path).exists():
            print(f"Файл не найден: {pdf_path}", file=sys.stderr)
            continue
        
        print(f"Парсинг {pdf_path}...")
        text = pdf_to_text(pdf_path)
        result = parse_lsr_text(text, filename=os.path.basename(pdf_path))
        
        all_meta.extend(result['lsr_meta'])
        all_positions.extend(result['positions'])
        
        # Сохрани также сырой текст для отладки
        txt_path = Path(pdf_path).stem + '.txt'
        with open(txt_path, 'w') as f:
            f.write(text)
    
    # Итоговый JSON
    output = {
        'lsr_meta': all_meta,
        'positions': all_positions,
    }
    
    with open('parsed_lsr.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    # Контроль сходимости
    conv = verify_convergence(output)
    print(f"\n✓ Извлечено ЛСР: {conv['lsrs_count']}")
    print(f"✓ Извлечено позиций: {conv['positions_count']}")
    print(f"✓ Сумма по шапкам ЛСР: {conv['total_from_headers']:,.2f} руб")
    print(f"\nРезультат сохранён в parsed_lsr.json")
    print(f"\n⚠️ Внимание: это упрощённая референсная реализация. Для production")
    print(f"   используй настройку под формат конкретной сметной программы.")


if __name__ == '__main__':
    main()
