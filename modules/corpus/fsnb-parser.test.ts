/**
 * Тесты написаны до реализации по спецификации A2 (docs/track-a-tasks.md).
 *
 * Разметка взята из настоящего файла ГЭСНм.xml ФСНБ-2022, полученного из
 * официального набора открытых данных ФГИС ЦС.
 */
import { describe, expect, it } from "vitest";

import { parseFsbcChunk, parseFsnbChunk } from "./fsnb-parser.js";

const SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<base PriceLevel="01.01.2022">
<ResourcesDirectory>
<ResourceCategory Type="МОНТАЖ ОБОРУДОВАНИЯ" CodePrefix="ГЭСНм">
<Section Name="Металлообрабатывающее оборудование" Type="Сборник" Code="01">
<Section Name="Станки массой от 1,1 до 20 т" Type="Таблица" Code="01-01-001">
<NameGroup BeginName="Станок в собранном виде: токарный">
<Work Code="01-01-001-01" EndName="от 1,1 до 2 т" MeasureUnit="шт">
<Resources>
<Resource Code="1-100-38" EndName="Средний разряд работы 3,8" Quantity="9.3" />
<Resource Code="91.05.04-007" EndName="Краны мостовые электрические" Quantity="0.52" />
</Resources>
</Work>
<Work Code="01-01-001-02" EndName="до 3 т" MeasureUnit="шт">
</Work>
</NameGroup>
<NameGroup BeginName="Шкаф управления">
<Work Code="08-03-572-06" EndName="масса до 0,5 т" MeasureUnit="100 шт">
</Work>
</NameGroup>
</Section>
</Section>
</ResourceCategory>
</ResourcesDirectory>
</base>`;

describe("разбор ФСНБ-2022 (ГЭСН/ФЕР)", () => {
  const entries = parseFsnbChunk(SAMPLE);

  it("извлекает все нормы, не считая ресурсы внутри них", () => {
    // <Resource> имеет те же атрибуты Code и EndName, что и <Work>, — перепутать легко.
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.code)).toEqual([
      "01-01-001-01",
      "01-01-001-02",
      "08-03-572-06",
    ]);
  });

  it("берёт префикс шифра из категории ресурсов", () => {
    expect(entries.every((entry) => entry.system === "ГЭСНм")).toBe(true);
  });

  it("собирает наименование из группы и окончания", () => {
    expect(entries[0]?.name).toBe("Станок в собранном виде: токарный от 1,1 до 2 т");
    expect(entries[1]?.name).toBe("Станок в собранном виде: токарный до 3 т");
  });

  it("переключает группу наименований при её смене", () => {
    expect(entries[2]?.name).toBe("Шкаф управления масса до 0,5 т");
  });

  it("берёт единицу измерения как она записана", () => {
    expect(entries[0]?.unit).toBe("шт");
    expect(entries[2]?.unit).toBe("100 шт");
  });

  it("декодирует сущности XML в наименовании", () => {
    const withEntities = parseFsnbChunk(
      `<ResourceCategory CodePrefix="ГЭСН">
       <NameGroup BeginName="Опоры &quot;А&quot; &amp; траверсы">
       <Work Code="01-01-001-01" EndName="&lt;тип 1&gt;" MeasureUnit="шт"></Work>
       </NameGroup></ResourceCategory>`,
    );

    expect(withEntities[0]?.name).toBe('Опоры "А" & траверсы <тип 1>');
  });

  it("не теряет норму без группы наименований", () => {
    const orphan = parseFsnbChunk(
      `<ResourceCategory CodePrefix="ФЕР">
       <Work Code="01-02-003-04" EndName="Разработка грунта" MeasureUnit="1000 м3"></Work>
       </ResourceCategory>`,
    );

    expect(orphan).toHaveLength(1);
    expect(orphan[0]?.name).toBe("Разработка грунта");
    expect(orphan[0]?.system).toBe("ФЕР");
  });

  it("пропускает норму без единицы измерения, но сообщает о ней", () => {
    const noUnit = parseFsnbChunk(
      `<ResourceCategory CodePrefix="ГЭСН">
       <Work Code="01-01-001-01" EndName="Без единицы"></Work>
       </ResourceCategory>`,
    );

    expect(noUnit).toHaveLength(1);
    expect(noUnit[0]?.unit).toBe("");
  });

  it("на пустом входе возвращает пусто, а не падает", () => {
    expect(parseFsnbChunk("")).toEqual([]);
    expect(parseFsnbChunk("<base></base>")).toEqual([]);
  });
});

const FSBC_SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<ResourceCatalog>
<ResourcesDirectory>
<ResourceCategory Type="Материал">
<Section Name="Материалы для строительных работ" Code="01" Type="Книга">
<Section Name="Детали фасонные" Code="01.1.01.01" Type="Группа">
<Resource Code="01.1.01.01-0002" Name="Детали фасонные коньковые" MeasureUnit="100 компл">
<Prices><Price Cost="35537.67" OptCost="34458.33" /></Prices>
</Resource>
</Section>
</Section>
</ResourceCategory>
<ResourceCategory Type="Оборудование">
<Resource Code="08.3.05.02-0021" Name="Шкаф телекоммуникационный" MeasureUnit="шт">
<Prices><Price Cost="1000" /></Prices>
</Resource>
</ResourceCategory>
</ResourcesDirectory>
</ResourceCatalog>`;

describe("разбор ФСБЦ (сметные цены ресурсов)", () => {
  const entries = parseFsbcChunk(FSBC_SAMPLE);

  it("извлекает записи каталога ресурсов", () => {
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.code)).toEqual(["01.1.01.01-0002", "08.3.05.02-0021"]);
  });

  it("берёт наименование целиком из атрибута Name", () => {
    // В ФСБЦ имя не разбито на начало и окончание, в отличие от ГЭСН.
    expect(entries[0]?.name).toBe("Детали фасонные коньковые");
  });

  it("относит все категории ресурсов к системе ФСБЦ", () => {
    // Именно так шифр записан в реальной смете: «ФСБЦ-08.3.05.02-0021».
    expect(entries.every((entry) => entry.system === "ФСБЦ")).toBe(true);
  });

  it("берёт единицу измерения ресурса", () => {
    expect(entries[0]?.unit).toBe("100 компл");
    expect(entries[1]?.unit).toBe("шт");
  });

  it("не принимает расход внутри нормы ГЭСН за запись каталога", () => {
    // У расхода есть Quantity и EndName, но нет Name — это ссылка, а не запись.
    const inside = parseFsbcChunk(
      `<ResourceCategory Type="Материал">
       <Resource Code="1-100-38" EndName="Средний разряд работы 3,8" Quantity="9.3" />
       </ResourceCategory>`,
    );

    expect(inside).toEqual([]);
  });

  it("на пустом входе возвращает пусто", () => {
    expect(parseFsbcChunk("")).toEqual([]);
  });
});
