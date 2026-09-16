const puppeteer = require('puppeteer'); 
(async () => { 
  const browser = await puppeteer.launch({ headless: 'new', executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] }); 
  const page = await browser.newPage(); 
  await page.setViewport({ width: 1920, height: 1080 }); 
  await page.goto('file:///home/govard/projects/7rl/domovey-projects/2026-08-18/01_Domovey_VKH_Presentation.html'); 
  await new Promise(r => setTimeout(r, 2000)); 
  const el = await page.$('.slide:nth-child(8)'); 
  if(el) await el.screenshot({ path: '/home/govard/.gemini/antigravity-ide/brain/02e780e8-8eeb-4f55-800d-9b9562e477c0/vkh_slide8_check.png' }); 
  await browser.close(); 
})();
