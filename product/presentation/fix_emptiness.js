const fs = require('fs');

const files = [
    '02_Cases_And_Social_Proof.html',
    '03_Sales_Playbook_Presentation_V2.html'
];

for (let file of files) {
    let content = fs.readFileSync(file, 'utf-8');

    // 1. Fix the background bug
    if (!content.includes('.slide::before')) {
        content = content.replace('</style>', `
.slide::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: inherit;
  z-index: -1;
}
.slide { background-color: var(--white); }
.slide.theme-dark { background-color: var(--black); }
</style>`);
    }

    // 2. Enhance empty boxes
    const decorativeBox = `
    <div class="box" style="border: 2px dashed #E5E5E5; justify-content: center; align-items: center; opacity: 0.6; background: transparent;">
      <i class="fas fa-chart-network" style="font-size: 60px; color: var(--red); margin-bottom: 20px;"></i>
      <h3 style="color: var(--black);">Системный Анализ</h3>
      <p style="text-align: center; font-size: 18px;">Идет обработка данных в реальном времени...</p>
    </div>`;

    const decorativeBoxDark = `
    <div class="box theme-dark" style="border: 2px dashed #333; justify-content: center; align-items: center; opacity: 0.6; background: transparent;">
      <i class="fas fa-microchip" style="font-size: 60px; color: var(--red); margin-bottom: 20px;"></i>
      <h3 style="color: white;">Нейросетевой Контур</h3>
      <p style="text-align: center; color: #888; font-size: 18px;">Zero Trust Validation Active</p>
    </div>`;

    const statBox = `
    <div class="box" style="justify-content: center; background: var(--red); color: white; border: none;">
      <h2 style="font-size: 80px; margin: 0; color: white;">100%</h2>
      <p style="font-size: 24px; margin-top: 10px; color: white;">Оцифровка данных</p>
    </div>`;

    // Regex to find grid-2 with only one box inside
    // This is hard to do with regex perfectly, so let's do targeted replacements for the playbook slides

    if (file === '03_Sales_Playbook_Presentation_V2.html') {
        content = content.replace(
`<div class="grid-stretch grid-stretch-2">
    <div class="box">
      <h3 style="color:var(--red);">Неправильный Питч</h3>
      <p>"У нас есть 9 агентов на базе LLM, которые читают PDF и интегрируются по API".</p>
    </div>
    <div class="box theme-dark" style="border-color:var(--red);">
      <h3 style="color:var(--red);">Правильный Питч</h3>
      <p>"Среднее завышение сметы — 3.8%. При бюджете 5 млрд вы теряете 190 млн. Наш алгоритм находит эти деньги до подписания актов КС-2. Давайте сделаем слепой тест."</p>
    </div>
  </div>`,
`<div class="grid-stretch grid-stretch-3">
    <div class="box">
      <h3 style="color:var(--red);">Неправильный Питч</h3>
      <p style="font-size: 24px;">"У нас есть 9 агентов на базе LLM, которые читают PDF и интегрируются по API".</p>
      <div style="margin-top:auto; font-weight:bold; color:#888;">Результат: Потеря внимания</div>
    </div>
    <div class="box theme-dark" style="border-color:var(--red);">
      <h3 style="color:var(--red);">Правильный Питч</h3>
      <p style="color:white; font-size: 24px;">"Среднее завышение сметы — 3.8%. При бюджете 5 млрд вы теряете 190 млн. Наш алгоритм находит эти деньги до подписания актов КС-2."</p>
      <div style="margin-top:auto; font-weight:bold; color:white;">Результат: Захват внимания</div>
    </div>
    <div class="box" style="background:var(--red); border:none; justify-content:center; align-items:center; text-align:center;">
      <h2 style="font-size:60px; color:white; margin:0;">СЛЕПОЙ<br>ТЕСТ</h2>
      <p style="color:white; font-weight:bold;">Призыв к действию</p>
    </div>
  </div>`);

        content = content.replace(
`<div class="grid-stretch grid-stretch-2">
    <div class="box">
      <h3 style="color:var(--red);">Скрытая боль</h3>
      <p>Ощущение потери контроля. Подозрение, что подрядчики и собственный технадзор в сговоре.</p>
    </div>
    <div class="box theme-dark">
      <h3 style="color:var(--red);">Аргумент</h3>
      <p>"9 ИИ-агентов неподкупны. Они выявляют двойной учёт без человеческого фактора. Рост EBITDA на 2-4%."</p>
    </div>
  </div>`,
`<div class="grid-stretch grid-stretch-3">
    <div class="box">
      <h3 style="color:var(--red);">Скрытая боль</h3>
      <p style="font-size: 24px;">Ощущение потери контроля. Подозрение, что подрядчики и собственный технадзор в сговоре.</p>
    </div>
    <div class="box theme-dark">
      <h3 style="color:var(--red);">Аргумент</h3>
      <p style="font-size: 24px; color:white;">"9 ИИ-агентов неподкупны. Они выявляют двойной учёт без человеческого фактора. Рост EBITDA на 2-4%."</p>
    </div>
    <div class="box" style="background: #111; justify-content: center; align-items: center; border-color: var(--red);">
      <h2 style="font-size:80px; color:white; margin:0;">2-4%</h2>
      <p style="color:#BBB; font-weight:bold; text-align:center;">Рост чистой прибыли (EBITDA)</p>
    </div>
  </div>`);

        content = content.replace(
`<div class="grid-stretch grid-stretch-2">
    <div class="box">
      <h3 style="color:var(--red);">Скрытая боль</h3>
      <p>Уплата процентов за неиспользуемое банковское финансирование. Непредсказуемость платежей (CAPEX vs OPEX).</p>
    </div>
    <div class="box theme-dark">
      <h3 style="color:var(--red);">Аргумент</h3>
      <p>"Агент-Экономист строит точный график раскрытия эскроу-счетов. Финансовая модель проекта On-Premise исключает плату за токены (Zero Token Cost)."</p>
    </div>
  </div>`,
`<div class="grid-stretch grid-stretch-3">
    <div class="box">
      <h3 style="color:var(--red);">Скрытая боль</h3>
      <p style="font-size: 24px;">Уплата процентов за неиспользуемое банковское финансирование. Непредсказуемость платежей (CAPEX vs OPEX).</p>
    </div>
    <div class="box theme-dark">
      <h3 style="color:var(--red);">Аргумент</h3>
      <p style="font-size: 24px; color:white;">"Агент-Экономист строит точный график раскрытия эскроу-счетов. Финансовая модель проекта On-Premise исключает плату за токены."</p>
    </div>
    <div class="box" style="background: var(--red); justify-content: center; align-items: center; border: none;">
      <h2 style="font-size:80px; color:white; margin:0;">Zero</h2>
      <p style="color:white; font-weight:bold; text-align:center;">Token Cost (On-Premise)</p>
    </div>
  </div>`);
    }

    fs.writeFileSync(file, content);
}

console.log("HTML files updated with background fixes and density enhancers.");
