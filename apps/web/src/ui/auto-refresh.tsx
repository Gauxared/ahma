"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Обновление страницы, пока в очереди что-то живое.
 *
 * ЕДИНСТВЕННЫЙ КЛИЕНТСКИЙ КОМПОНЕНТ В ПРОДУКТЕ, И ЭТО ЗАПИСАНО
 *
 * `Ф-ADR-010`: состояние живёт на сервере, пока не доказано обратное. Здесь
 * доказано: страница с выполняющейся задачей устаревает сама по себе, и
 * человек, глядя на «в очереди», не знает — всё ещё в очереди или страница
 * старая. Кнопка «обновить» перекладывает на него работу, которую машина делает
 * лучше.
 *
 * SSE НЕ ВЗЯТ НАМЕРЕННО. Он требует держать соединение и отключать буферизацию
 * на обратном прокси (§9), а выигрыш здесь — секунды на задаче, которая идёт
 * минуты. Опрос раз в пять секунд честнее по цене; когда появится поток
 * событий, компонент заменится, а экраны не заметят.
 *
 * Опрос ПРЕКРАЩАЕТСЯ, когда живого не осталось: вечно тикающая страница греет
 * батарею и держит соединение ради ничего.
 */
export function AutoRefresh({ active, seconds = 5 }: { readonly active: boolean; readonly seconds?: number }) {
  const router = useRouter();
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    if (!active) return;

    const timer = setInterval(() => {
      setTicks((value) => value + 1);
      router.refresh();
    }, seconds * 1000);

    return () => clearInterval(timer);
  }, [active, seconds, router]);

  if (!active) return null;

  return (
    <span className="meta" role="status">
      {ticks === 0
        ? `состояние обновляется каждые ${seconds} с`
        : `состояние обновлено ${ticks} ${ticks === 1 ? "раз" : "раза"}`}
    </span>
  );
}
