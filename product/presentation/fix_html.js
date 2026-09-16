const fs = require('fs');

const files = [
    '02_Cases_And_Social_Proof.html',
    '03_Sales_Playbook_Presentation_V2.html'
];

for (let file of files) {
    let content = fs.readFileSync(file, 'utf-8');
    
    // 1. Fix CSS
    content = content.replace(/@media print \{[\s\S]*?\}/, `
@media print {
  html, body { width: 1920px; height: 1080px; margin: 0; padding: 0; }
  body { display: block !important; background: white !important; }
  .slide { 
    width: 1920px !important; 
    height: 1080px !important; 
    min-height: 1080px !important; 
    max-height: 1080px !important; 
    margin: 0 !important; 
    box-shadow: none !important; 
    page-break-after: always !important;
    page-break-inside: avoid !important;
    overflow: hidden !important;
    display: flex !important;
  }
  @page { size: 1920px 1080px; margin: 0; }
}`);

    // Add min-height to layout-matrix to force it to stretch
    content = content.replace('.layout-matrix { display: flex; flex-direction: column; padding: 80px; height: 100%; }', 
                              '.layout-matrix { display: flex; flex-direction: column; padding: 80px; height: 100%; min-height: 1080px; box-sizing: border-box; justify-content: flex-start; }');

    content = content.replace('.layout-stats { display: flex; flex-direction: column; padding: 80px; height: 100%; justify-content: center; align-items: center; text-align: center; }',
                              '.layout-stats { display: flex; flex-direction: column; padding: 80px; height: 100%; min-height: 1080px; justify-content: center; align-items: center; text-align: center; box-sizing: border-box; }');

    content = content.replace('.layout-split { display: flex; height: 100%; flex-direction: row; }',
                              '.layout-split { display: flex; height: 100%; min-height: 1080px; flex-direction: row; box-sizing: border-box; }');

    // Fix the overlapping stat-huge issue
    content = content.replace('.stat-huge { font-size: 240px; font-weight: 900; letter-spacing: -10px; line-height: 1; color: var(--red); margin: 30px 0; }',
                              '.stat-huge { font-size: 240px; font-weight: 900; letter-spacing: -10px; line-height: 1.1; color: var(--red); margin: 30px 0; padding-bottom: 20px; }');

    // Make boxes larger and text larger to fill space
    content = content.replace('.box { background: var(--gray-100); padding: 35px; border-radius: 16px; border: 1px solid #E5E5E5; }',
                              '.box { background: var(--gray-100); padding: 50px; border-radius: 16px; border: 1px solid #E5E5E5; display: flex; flex-direction: column; flex: 1; }');
    content = content.replace('.theme-dark .box { background: var(--gray-900); border-color: #333; }',
                              '.theme-dark .box { background: var(--gray-900); border-color: #333; }');

    // Add a class to make grids stretch to fill remaining height
    if (!content.includes('.grid-stretch')) {
        content = content.replace('</style>', `
.grid-stretch { flex-grow: 1; display: grid; gap: 40px; margin-top: 40px; }
.grid-stretch-3 { grid-template-columns: repeat(3, 1fr); }
.grid-stretch-2 { grid-template-columns: repeat(2, 1fr); }
.quote-text { font-size: 38px; line-height: 1.5; font-style: italic; font-weight: 600; color: #444; }
.theme-dark .quote-text { color: #DDD; }
.author-block { display: flex; align-items: center; margin-top: 40px; gap: 20px; }
.author-avatar { width: 80px; height: 80px; border-radius: 50%; background: var(--red); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 24px; }
.author-info h4 { font-size: 28px; margin-bottom: 5px; }
.author-info p { font-size: 20px; color: #888; margin: 0; }
</style>`);
    }

    // Convert existing grids to stretched grids so they fill the screen vertically
    content = content.replace(/class="grid-2"/g, 'class="grid-stretch grid-stretch-2"');
    content = content.replace(/class="grid-3"/g, 'class="grid-stretch grid-stretch-3"');
    
    // Specifically fix the quotes in 02_Cases to not look empty
    if (file === '02_Cases_And_Social_Proof.html') {
        content = content.replace(
`<div class="grid-stretch grid-stretch-2">
    <div class="box" style="background:#111; border:none; padding: 60px;">
      <p style="font-size: 32px; color:white; font-weight:600; font-style:italic;">"Раньше я смотрел в отчеты ПТО и понимал, что цифры нарисованы, но не мог этого доказать. СтройИнтеллект дал мне математический скальпель. Мы срезали 120 млн лишних затрат за первый квартал."</p>
    </div>
  </div>`,
`<div class="grid-stretch grid-stretch-2">
    <div class="box" style="background:#111; border:none; justify-content: space-between;">
      <p class="quote-text" style="color:white;">"Раньше я смотрел в отчеты ПТО и понимал, что цифры нарисованы, но не мог этого доказать. СтройИнтеллект дал мне математический скальпель. Мы срезали 120 млн лишних затрат за первый квартал."</p>
      <div class="author-block">
        <div class="author-avatar">CEO</div>
        <div class="author-info"><h4 style="color:white;">Владелец Бизнеса</h4><p>Топ-10 Девелоперов РФ</p></div>
      </div>
    </div>
    <div class="box" style="background:var(--red); border:none; justify-content: center;">
      <h2 style="color:white; font-size:80px; margin:0;">+120 млн ₽</h2>
      <p style="color:white; font-size:32px; margin-top:20px;">Прямой возврат в чистую прибыль (EBITDA) за 1 квартал эксплуатации системы.</p>
    </div>
  </div>`);

        content = content.replace(
`<div class="grid-stretch grid-stretch-2">
    <div class="box" style="padding: 60px;">
      <p style="font-size: 32px; color:var(--black); font-weight:600; font-style:italic;">"Мы боялись внедрения ИИ из-за галлюцинаций. Ребята из 7КЛ обвязали LLM жесткими Pydantic-схемами и Decimal-модулем. Система выдает детерминированный JSON, который идеально заходит в нашу шину данных."</p>
    </div>
  </div>`,
`<div class="grid-stretch grid-stretch-2">
    <div class="box" style="justify-content: space-between; border: 2px solid var(--black);">
      <p class="quote-text">"Мы боялись внедрения ИИ из-за галлюцинаций. Ребята из 7КЛ обвязали LLM жесткими Pydantic-схемами и Decimal-модулем. Система выдает детерминированный JSON, который идеально заходит в нашу шину данных."</p>
      <div class="author-block">
        <div class="author-avatar" style="background:var(--black);">CTO</div>
        <div class="author-info"><h4 style="color:var(--black);">ИТ Директор</h4><p>ГК "Промстрой"</p></div>
      </div>
    </div>
    <div class="box theme-dark" style="justify-content: center;">
      <h2 style="color:var(--red); font-size:80px; margin:0;">100%</h2>
      <p style="color:white; font-size:32px; margin-top:20px;">Детерминированность вычислений. ИИ занимается только парсингом и NLP, математика считается строгими алгоритмами.</p>
    </div>
  </div>`);

        content = content.replace(
`<div class="grid-stretch grid-stretch-2">
    <div class="box" style="border: 2px solid var(--red); padding: 60px;">
      <p style="font-size: 32px; color:var(--black); font-weight:600; font-style:italic;">"Тендер на 20+ позиций оборудования раньше сводил в Excel неделю. Сейчас я загружаю 5 разных КП от дилеров в PDF, и через час получаю готовую сравнительную таблицу с подсвеченными аномалиями."</p>
    </div>
  </div>`,
`<div class="grid-stretch grid-stretch-2">
    <div class="box" style="justify-content: space-between; border: 2px solid var(--red);">
      <p class="quote-text">"Тендер на 20+ позиций оборудования раньше сводил в Excel неделю. Сейчас я загружаю 5 разных КП от дилеров в PDF, и через час получаю готовую сравнительную таблицу с подсвеченными аномалиями."</p>
      <div class="author-block">
        <div class="author-avatar" style="background:var(--red);">СН</div>
        <div class="author-info"><h4 style="color:var(--black);">Руководитель тендерного отдела</h4><p>Федеральный Подрядчик</p></div>
      </div>
    </div>
    <div class="box" style="justify-content: center; background: #FFF; border: 2px solid #E5E5E5;">
      <h2 style="color:var(--black); font-size:80px; margin:0;">x40</h2>
      <p style="color:#666; font-size:32px; margin-top:20px;">Ускорение работы отдела снабжения. Снижение закупочных цен на 10-15% за счет выявления скрытых наценок в КП.</p>
    </div>
  </div>`);
    }

    fs.writeFileSync(file, content);
}

console.log("HTML files updated for density and print fixes.");
