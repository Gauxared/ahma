/**
 * Курганский комплект — эталонный кейс M1.
 *
 * Это единственный полный сквозной кейс в репозитории: вход в
 * `reference-system/input-1`, выход девяти агентов в `reference-system/output-1`.
 * Он же будущий эталонный образец по ТЗ §6.5.
 *
 * Ожидаемые суммы взяты из самих документов (строки «ВСЕГО по смете»), а не
 * пересчитаны нами: тест обязан ловить расхождение с источником, а не с нашей
 * же арифметикой.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

export const KURGAN_INPUT = join(process.cwd(), "reference-system/input-1");

export interface KurganFile {
  readonly file: string;
  /** «ВСЕГО по смете» в рублях, как объявлено в документе. */
  readonly declaredTotal: string;
  readonly sections: number;
  readonly positions: number;
  readonly form: "appendix-3" | "appendix-4";
}

export const KURGAN_LSR: readonly KurganFile[] = [
  {
    file: "РИМ Курган_СОТВ_ испр. - ЛСР по Методике 2020 _РМ_.xlsx",
    declaredTotal: "14198884.54",
    sections: 1,
    positions: 44,
    form: "appendix-4",
  },
  {
    file: "РИМ Курган_ЭОМ__ЭОМ испр. - ЛСР по Методике 2020 _РМ_.xlsx",
    declaredTotal: "89532565.11",
    // Раздел 3 «Мебель» объявлен, но пуст: ни позиций, ни итога.
    sections: 3,
    positions: 54,
    form: "appendix-4",
  },
  {
    file: "РИМ ПНР Курган_СОТВ_ испр. - ЛСР по Методике 2020 _РМ_.xlsx",
    declaredTotal: "890669.50",
    sections: 1,
    positions: 2,
    form: "appendix-4",
  },
  {
    file: "РИМ СП и СИ - ЛСР по Методике 2020 _РИМ_.xlsx",
    declaredTotal: "354583.33",
    sections: 1,
    positions: 1,
    form: "appendix-3",
  },
];

/** Сумма всех ЛСР комплекта в рублях. */
export const KURGAN_SUM_OF_LSR = "104976702.48";

/** «Итого по Главам 1-9» из ССРСС, в тыс. руб. */
export const KURGAN_SSRSS_THOUSANDS = "104976.71";

export function kurganAvailable(): boolean {
  return KURGAN_LSR.every((entry) => existsSync(join(KURGAN_INPUT, entry.file)));
}

export function kurganPath(file: string): string {
  return join(KURGAN_INPUT, file);
}
