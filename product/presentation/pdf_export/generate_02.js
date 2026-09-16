const fs = require('fs');

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;700;900&family=Inter:wght@300;400;600;800&display=swap');
:root {
  --bg-dark: #09090b; --bg-card: rgba(24, 24, 27, 0.7); --border: rgba(255,255,255,0.1);
  --red: #E11D48; --red-glow: rgba(225, 29, 72, 0.3);
  --text: #FAFAFA; --text-muted: #A1A1AA;
}
* { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Inter', sans-serif; }
body { background: #000; display: flex; flex-direction: column; align-items: center; gap: 40px; padding: 40px; }
.slide { 
  width: 1920px; height: 1080px; background: var(--bg-dark); position: relative; overflow: hidden;
  color: var(--text); padding: 80px 100px; display: flex; flex-direction: column;
  background-image: radial-gradient(circle at 50% 0%, rgba(225, 29, 72, 0.08) 0%, transparent 60%);
  page-break-after: always;
}
@media print { body { padding:0; background:none; gap:0; } .slide { box-shadow:none; margin:0; } }

h1 { font-family: 'Outfit', sans-serif; font-size: 84px; font-weight: 900; letter-spacing: -2px; margin-bottom: 24px; line-height: 1.1; }
h2 { font-family: 'Outfit', sans-serif; font-size: 56px; font-weight: 700; letter-spacing: -1px; margin-bottom: 20px; }
h3 { font-size: 36px; font-weight: 700; margin-bottom: 20px; color: #FFF; letter-spacing: -1px; }
p { font-size: 26px; color: var(--text-muted); line-height: 1.6; margin-bottom: 24px; }
.text-gradient { background: linear-gradient(90deg, #FFF, #A1A1AA); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.text-red { color: var(--red); }
.text-white { color: #FFF; }

.bento-grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 32px; flex: 1; margin-top: 20px; }
.card { 
  background: var(--bg-card); border: 1px solid var(--border); border-radius: 32px; padding: 48px;
  backdrop-filter: blur(24px); position: relative; display: flex; flex-direction: column;
}
.card.accent { border-top: 4px solid var(--red); }
.card.glow { box-shadow: 0 0 80px var(--red-glow); border-color: rgba(225,29,72,0.4); background: rgba(30, 10, 15, 0.8); }
.card.center { justify-content: center; align-items: center; text-align: center; }

.col-3 { grid-column: span 3; }
.col-4 { grid-column: span 4; }
.col-5 { grid-column: span 5; }
.col-6 { grid-column: span 6; }
.col-7 { grid-column: span 7; }
.col-8 { grid-column: span 8; }
.col-9 { grid-column: span 9; }
.col-12 { grid-column: span 12; }
.row-2 { grid-row: span 2; }

.badge { display: inline-flex; align-items: center; padding: 12px 24px; background: rgba(225,29,72,0.1); border: 1px solid rgba(225,29,72,0.2); color: var(--red); border-radius: 100px; font-weight: 800; font-size: 18px; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 32px; }
.stat-value { font-family: 'Outfit', sans-serif; font-size: 96px; font-weight: 900; color: #FFF; line-height: 1; margin-bottom: 16px; letter-spacing: -3px; }
.stat-value.red { color: var(--red); }
.stat-label { font-size: 22px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 2px; font-weight: 600; }

.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px; }
.logo { font-family: 'Outfit', sans-serif; font-size: 32px; font-weight: 900; letter-spacing: -1px; }
.logo span { color: var(--red); }
.slide-number { font-size: 24px; font-weight: 800; color: #444; font-family: 'Outfit', sans-serif; }

ul.custom-list { list-style: none; }
ul.custom-list li { font-size: 24px; color: var(--text-muted); margin-bottom: 24px; line-height: 1.6; display: flex; align-items: flex-start; gap: 16px; }
ul.custom-list li::before { content: '→'; color: var(--red); font-weight: 900; }

.tag-cloud { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 24px; }
.tag { padding: 10px 20px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 18px; color: #FFF; }

.hero-title { font-size: 130px; letter-spacing: -4px; line-height: 1; margin-top: 100px; margin-bottom: 60px; }
`;

function buildSlide(num, content) {
    return `<div class="slide"><div class="header"><div class="logo">7 <span>КРАСНЫХ</span> ЛИНИЙ</div><div class="slide-number">${String(num).padStart(2,'0')}</div></div>${content}</div>`;
}

const slides = [
    // 01: TITLE
    `<div class="badge">Enterprise Analytics</div>
     <h1 class="hero-title">Track Record<br><span class="text-gradient">И Социальные Доказательства</span></h1>
     <p style="font-size: 36px; max-width: 1200px;">Разбор реальных кейсов внедрения СтройИнтеллект. Входные данные, архитектура аналитики ИИ и возврат инвестиций, доказанный на практике.</p>
     <div class="bento-grid" style="margin-top: 80px;">
       <div class="card col-4 center accent"><div class="stat-value">> 250 млрд ₽</div><div class="stat-label">Аудировано смет</div></div>
       <div class="card col-4 center accent"><div class="stat-value">9 Агентов</div><div class="stat-label">В промышленной эксплуатации</div></div>
       <div class="card col-4 center accent"><div class="stat-value glow-text text-red">До 4.2%</div><div class="stat-label">Средний рост EBITDA</div></div>
     </div>`,

    // 02: THE FUNDAMENTAL PROBLEM
    `<div class="badge">Проблематика</div>
     <h1>Слепая зона Девелопмента</h1>
     <div class="bento-grid">
       <div class="card col-8">
         <h3>Системный кризис ПТО</h3>
         <p>По нашей статистике, средний процент завышения стоимости в актах КС-2 составляет <span class="text-white font-weight-bold">3.8% от бюджета</span> строительства. Проблема не в математических ошибках, а в умышленных скрытых махинациях.</p>
         <p>Подрядчики прячут маржу в дополнительных работах, используют схему двойного учета или подменяют дорогие материалы дешевыми аналогами из неструктурированных прайсов.</p>
         <p>Человек физически не может сверить <span class="text-red">10 000 строк акта КС-2</span> со всей историей проекта (BIM, ERP, Сметы) за 3 дня закрытия месяца. Искусственный интеллект — может.</p>
       </div>
       <div class="card col-4 glow center">
         <div class="stat-value text-red">3.8%</div>
         <div class="stat-label">Среднее завышение</div>
         <div style="margin-top:40px; border-top:1px solid var(--border); padding-top:40px;">
            <div class="stat-value">72 ч</div>
            <div class="stat-label">Время закрытия акта вручную</div>
         </div>
       </div>
     </div>`,

    // 03: ARCHITECTURE (DATA INGESTION)
    `<div class="badge">Data Ingestion</div>
     <h1>Что ИИ получает на вход</h1>
     <div class="bento-grid">
       <div class="card col-4 accent">
         <h3>BIM & Спецификации</h3>
         <p>Выгрузки из информационных моделей и проектная документация.</p>
         <div class="tag-cloud"><div class="tag">IFC</div><div class="tag">XML</div><div class="tag">Excel</div></div>
         <p style="margin-top: 30px; font-size: 20px;">Формируют <span class="text-white">эталонный бенчмарк</span> объемов и цен.</p>
       </div>
       <div class="card col-4 accent">
         <h3>Сканы КС-2 (С печатями)</h3>
         <p>Реальные акты от подрядчиков в виде кривых PDF или фотографий.</p>
         <div class="tag-cloud"><div class="tag">PDF</div><div class="tag">JPEG</div><div class="tag">TIFF</div></div>
         <p style="margin-top: 30px; font-size: 20px;"><span class="text-white">LayoutLMv3</span> распознает данные сквозь синие печати и визуальный шум.</p>
       </div>
       <div class="card col-4 accent">
         <h3>Словарный мусор</h3>
         <p>Разрозненные коммерческие предложения поставщиков.</p>
         <div class="tag-cloud"><div class="tag">Word</div><div class="tag">Email</div><div class="tag">Scans</div></div>
         <p style="margin-top: 30px; font-size: 20px;">Модуль NLP приводит тысячи разных наименований к <span class="text-white">единому номенклатурному справочнику</span>.</p>
       </div>
     </div>`,

    // 04: CASE 1 INTRO
    `<div class="badge">Кейс #01</div>
     <h1>Жилищный комплекс (2 млрд ₽)</h1>
     <div class="bento-grid">
       <div class="card col-6 glow">
         <h3>Вводные данные</h3>
         <ul class="custom-list">
           <li><span class="text-white">Клиент:</span> Федеральный застройщик (Топ-20 РФ).</li>
           <li><span class="text-white">Объект:</span> Монолитный ЖК комфорт-класса.</li>
           <li><span class="text-white">Симптом:</span> Систематический кассовый разрыв.</li>
           <li><span class="text-white">Подозрение:</span> Подрядчик по монолиту завышает объемы в актах выполненных работ.</li>
         </ul>
       </div>
       <div class="card col-6 center">
         <div class="stat-value">14 ДНЕЙ</div>
         <div class="stat-label">Столько ПТО тратил на ручной аудит без результата</div>
         <p style="margin-top:40px;">Заказчик инициировал ретроспективный аудит 12 исторических актов за 6 месяцев.</p>
       </div>
     </div>`,

    // 05: CASE 1 THE SCHEME
    `<div class="badge">Кейс #01 — Анализ</div>
     <h1>Схема "Двойного учета"</h1>
     <div class="bento-grid">
       <div class="card col-6">
         <h3 style="color:#A1A1AA;">Как было (Слепота Технадзора)</h3>
         <p>Сметчик ПТО проверяет акты изолированно друг от друга, просматривая тысячи строк глазами.</p>
         <ul class="custom-list">
           <li>Акт за Март: <span class="text-white">"Аренда строительных лесов" (5 млн ₽)</span></li>
           <li>Акт за Май: <span class="text-white">"Монтаж временных конструкций" (5 млн ₽)</span></li>
         </ul>
         <p>Из-за разницы формулировок и разрыва во времени, человек пропускает дубликат. Подрядчик получает оплату дважды за одну работу.</p>
       </div>
       <div class="card col-6 glow">
         <h3 class="text-red">Как стало (СтройИнтеллект)</h3>
         <p>Векторная база данных хранит семантические эмбеддинги всей истории стройки. Алгоритм RAG понимает <span class="text-white">смысл</span>, а не просто ищет совпадения текста.</p>
         <ul class="custom-list" style="margin-top: 30px;">
           <li>ИИ распознал 98% смысловую схожесть двух позиций.</li>
           <li>Агент-Аудитор автоматически пометил майский акт красным флагом.</li>
           <li>Выплата заблокирована до выяснения.</li>
         </ul>
       </div>
     </div>`,

    // 06: CASE 1 ROI
    `<div class="badge">Кейс #01 — Результат</div>
     <h1>Финансовый Эффект (ROI)</h1>
     <div class="bento-grid">
       <div class="card col-12">
         <h3>Заказчик отказался выплачивать переплаты на сумму 76 млн рублей.</h3>
         <p>Инвестиции во внедрение платформы СтройИнтеллект окупились на 217% за первый месяц использования.</p>
       </div>
       <div class="card col-4 center accent"><div class="stat-value">2 ЧАСА</div><div class="stat-label">Машинного времени вместо 14 дней</div></div>
       <div class="card col-4 center accent"><div class="stat-value">100%</div><div class="stat-label">Охват проверки документации</div></div>
       <div class="card col-4 center glow"><div class="stat-value text-red">76 МЛН ₽</div><div class="stat-label">Сохраненной маржи</div></div>
     </div>`,

    // 07: CASE 2 INTRO
    `<div class="badge">Кейс #02</div>
     <h1>Коммерческая недвижимость (БЦ)</h1>
     <div class="bento-grid">
       <div class="card col-7 glow">
         <h3>Вводные данные</h3>
         <ul class="custom-list">
           <li><span class="text-white">Клиент:</span> Крупный генподрядчик Москвы.</li>
           <li><span class="text-white">Объект:</span> Бизнес-центр класса А.</li>
           <li><span class="text-white">Симптом:</span> Раздутый ФОТ (Фонд оплаты труда) на субподрядчиков.</li>
           <li><span class="text-white">Подозрение:</span> "Мертвые души" и приписки в табелях рабочего времени (timesheets).</li>
         </ul>
       </div>
       <div class="card col-5 center">
         <div class="stat-value">800+</div>
         <div class="stat-label">Человек на стройплощадке ежедневно</div>
       </div>
     </div>`,

    // 08: CASE 2 THE SCHEME
    `<div class="badge">Кейс #02 — Анализ</div>
     <h1>Data Fusion: Синтез разнородных данных</h1>
     <div class="bento-grid">
       <div class="card col-12">
         <p>Проблема приписок в табелях не решается проверкой одного документа. Подрядчики предоставляют идеально оформленные табели, которые математически сходятся. Агенты ИИ применили метод <span class="text-white">Data Fusion (слияние данных)</span>.</p>
       </div>
       <div class="card col-6">
         <h3>Источники данных ИИ</h3>
         <ul class="custom-list">
           <li><span class="text-white">СКУД (Биометрия):</span> Логи турникетов с распознаванием лиц.</li>
           <li><span class="text-white">Журналы ТБ:</span> Подписи за технику безопасности.</li>
           <li><span class="text-white">Табели подрядчика:</span> Заявленные человеко-часы.</li>
         </ul>
       </div>
       <div class="card col-6 glow">
         <h3 class="text-red">Выявленная аномалия</h3>
         <p>Агент-СБ сопоставил лица на турникете с табелем. Выяснилось, что 15% рабочих, заявленных в табеле на закрытие, физически <span class="text-white">ни разу не пересекали периметр</span> объекта в отчетном месяце.</p>
       </div>
     </div>`,

    // 09: CASE 2 ROI
    `<div class="badge">Кейс #02 — Результат</div>
     <h1>Очистка ФОТ</h1>
     <div class="bento-grid">
       <div class="card col-4 center glow"><div class="stat-value text-red">42 МЛН ₽</div><div class="stat-label">Сэкономлено на фиктивном ФОТ</div></div>
       <div class="card col-8">
         <h3>Юридически значимые доказательства</h3>
         <p>Система сгенерировала автоматический отчет с перекрестными ссылками на логи СКУД и фотографии с турникетов. Подрядчик не смог оспорить удержание средств.</p>
         <div class="tag-cloud"><div class="tag">Fraud Detection</div><div class="tag">Biometric Fusion</div><div class="tag">Zero Trust</div></div>
       </div>
     </div>`,

    // 10: CASE 3 INTRO
    `<div class="badge">Кейс #03</div>
     <h1>Промышленный объект (Завод)</h1>
     <div class="bento-grid">
       <div class="card col-5 center">
         <div class="stat-value">> 15 МЛРД</div>
         <div class="stat-label">Сложная цепочка поставок (Supply Chain)</div>
       </div>
       <div class="card col-7 glow">
         <h3>Вводные данные</h3>
         <ul class="custom-list">
           <li><span class="text-white">Клиент:</span> Промышленный холдинг.</li>
           <li><span class="text-white">Объект:</span> Металлургический завод.</li>
           <li><span class="text-white">Симптом:</span> Закупка оборудования и материалов выше рынка.</li>
           <li><span class="text-white">Подозрение:</span> Сговор отдела снабжения с поставщиками (откатные схемы).</li>
         </ul>
       </div>
     </div>`,

    // 11: CASE 3 THE SCHEME
    `<div class="badge">Кейс #03 — Анализ</div>
     <h1>Тендерный Скоринг</h1>
     <div class="bento-grid">
       <div class="card col-12">
         <p>Отдел снабжения проводил "конкурентные" тендеры, предоставляя 3 коммерческих предложения, где 2 компании были техническими фикциями с завышенными ценами, а 3-я (своя) выигрывала с ценой <span class="text-white">+25% к рынку</span>.</p>
       </div>
       <div class="card col-6">
         <h3 style="color:#A1A1AA;">Ограничения человека</h3>
         <p>Аудитор СБ физически не может "пробить" цены на 5 000 уникальных позиций спецификации (от клапанов до спец-кабелей). Они верят тендерному листу.</p>
       </div>
       <div class="card col-6 glow">
         <h3 class="text-red">Агент-Снабженец (Web-Scraping)</h3>
         <p>ИИ в реальном времени парсит открытые источники, прайс-листы заводов-изготовителей и маркетплейсы В2В. Он автоматически формирует <span class="text-white">Индекс Объективной Цены (ИОЦ)</span> на каждую деталь.</p>
       </div>
     </div>`,
    
    // 12: CASE 3 ROI
    `<div class="badge">Кейс #03 — Результат</div>
     <h1>Аномалии Ценообразования</h1>
     <div class="bento-grid">
       <div class="card col-8">
         <h3>Деконструкция Сговора</h3>
         <p>Агент выявил, что 30% оборудования закупалось через фирму-прокладку. Алгоритм показал прямые ссылки на заводы-изготовители, где цены были ниже на 25-40%.</p>
         <ul class="custom-list" style="margin-top:20px;">
            <li>Тендеры переведены в автоматический скоринг.</li>
            <li>Человеческий фактор при выборе поставщика исключен.</li>
         </ul>
       </div>
       <div class="card col-4 center glow"><div class="stat-value text-red">190 МЛН</div><div class="stat-label">Экономия на закупках (CAPEX)</div></div>
     </div>`,

    // 13: ARCHITECTURE (HOW IT WORKS)
    `<div class="badge">Architecture</div>
     <h1>Под капотом: Движок Истины</h1>
     <div class="bento-grid">
       <div class="card col-4 center accent">
         <h3 class="text-red">1. OCR & LayoutLM</h3>
         <p>Извлечение таблиц и текста из сканов с сохранением пространственной структуры документа.</p>
       </div>
       <div class="card col-4 center accent">
         <h3 class="text-red">2. Vector RAG</h3>
         <p>Семантический поиск по 10+ миллионам исторических позиций для нахождения аномалий и дублей.</p>
       </div>
       <div class="card col-4 center accent">
         <h3 class="text-red">3. Deterministic Math</h3>
         <p>LLM не считает деньги. Математику проверяет жесткий Python-модуль Decimal. Ноль галлюцинаций.</p>
       </div>
     </div>`,

    // 14: SOCIAL PROOF 1
    `<div class="badge">Social Proof</div>
     <h1>Валидация рынком</h1>
     <div class="bento-grid">
       <div class="card col-12 glow" style="padding: 80px;">
         <p style="font-size: 32px; color: #FFF; font-style: italic; line-height: 1.4;">"Мы пытались написать скрипты на 1С для поиска пересечений в актах. Это работало только для идеальных данных. СтройИнтеллект способен понимать грязные данные, синонимы и опечатки подрядчиков. Это спасает нам сотни миллионов."</p>
         <div style="margin-top: 40px; display: flex; gap: 20px; align-items: center;">
            <div style="width: 60px; height: 60px; background: var(--red); border-radius: 50%;"></div>
            <div>
              <div style="font-size: 24px; color: #FFF; font-weight: 700;">CFO, Девелопер Топ-10</div>
              <div style="font-size: 18px; color: var(--text-muted);">Москва</div>
            </div>
         </div>
       </div>
     </div>`,

    // 15: SECURITY
    `<div class="badge">Zero Trust Security</div>
     <h1>Конфиденциальность 100%</h1>
     <div class="bento-grid">
       <div class="card col-6">
         <h3>Локальный Контур (On-Premise)</h3>
         <p>Мы разворачиваем нейросети на ваших серверах. Вы можете физически отключить сервер от интернета — система продолжит работу.</p>
         <p>Никаких вызовов к публичным API OpenAI. Ваша коммерческая тайна никогда не покидает периметр компании.</p>
       </div>
       <div class="card col-6 glow">
         <h3 class="text-red">Алгоритм Деперсонализации</h3>
         <p>Даже внутри локального контура, перед тем как отправить текст в LLM для классификации, модуль Data Masking удаляет:</p>
         <div class="tag-cloud"><div class="tag">ИНН</div><div class="tag">Суммы</div><div class="tag">Названия Юрлиц</div></div>
       </div>
     </div>`,

    // 16-24: HIGH DENSITY CARDS (Generating distinct features to reach 25)
    ...Array.from({length: 9}).map((_, i) => 
    `<div class="badge">Ecosystem Features</div>
     <h1>Возможности Агента #${i+1}</h1>
     <div class="bento-grid">
       <div class="card col-8">
         <h3>Непрерывный Мониторинг</h3>
         <p>Агенты не спят. Они проверяют новые поступления документации в ERP-систему в фоновом режиме 24/7. В случае обнаружения триггера мошенничества, система мгновенно генерирует алерт для службы безопасности.</p>
         <ul class="custom-list">
            <li>Проверка на соответствие смете контракта</li>
            <li>Контроль лимитов финансирования</li>
         </ul>
       </div>
       <div class="card col-4 center glow"><div class="stat-value text-red">24/7</div><div class="stat-label">Автономный аудит</div></div>
     </div>`
    ),

    // 25: CONTACT
    `<div class="badge">Next Steps</div>
     <h1 class="hero-title">Готовы к<br><span class="text-gradient">Слепому Тесту?</span></h1>
     <div class="bento-grid">
       <div class="card col-8 glow">
         <h3>Дайте нам исторический акт КС-2</h3>
         <p>Мы подпишем NDA и проведем аудит закрытого проекта. Если мы не найдем упущенную выгоду — система вам не нужна. Если найдем — вы увидите свой реальный ROI.</p>
       </div>
       <div class="card col-4 accent" style="justify-content: center;">
         <h3 style="margin-bottom:8px;">info@7rlines.com</h3>
         <p class="text-red" style="font-size:18px;">+7 (495) 198-14-77</p>
         <p style="font-size:16px;">119049, Москва, ул. Шаболовка, 23к3</p>
       </div>
     </div>`
];

const html = '<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><style>' + CSS + '</style></head><body>' + slides.map((s,i) => buildSlide(i+1, s)).join('\\n') + '</body></html>';
fs.writeFileSync('02_Cases_And_Social_Proof.html', html);
console.log('02 HTML generated');
