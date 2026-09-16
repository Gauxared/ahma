const puppeteer = require('puppeteer');
const path = require('path');

async function exportToPDF() {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({ 
        headless: 'new', 
        executablePath: '/usr/bin/google-chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    const inputHtml = `file:///home/govard/projects/7rl/domovey-projects/2026-08-18/01_Domovey_VKH_Presentation.html`;
    const outputPdf = '/home/govard/projects/7rl/domovey-projects/2026-08-18/Domovey_VKH_Presentation.pdf';
    
    try {
        await page.goto(inputHtml, { waitUntil: 'networkidle0', timeout: 30000 });
    } catch (e) {
        console.log('Timeout reached, but continuing because external resources might be blocked...');
    }
    console.log('Page loaded, waiting 3 seconds for fonts...');
    await new Promise(r => setTimeout(r, 3000));
    
    // Take screenshots for visual check
    console.log('Taking visual check screenshots...');
    const takeScreenshot = async (selector, path) => {
        const element = await page.$(selector);
        if (element) {
            await element.screenshot({ path });
        }
    };
    await takeScreenshot('.slide:nth-child(1)', 'vkh_slide1_check.png');
    await takeScreenshot('.slide:nth-child(4)', 'vkh_slide4_check.png');
    await takeScreenshot('.slide:nth-child(9)', 'vkh_slide9_check.png');
    await takeScreenshot('.slide:nth-child(10)', 'vkh_slide10_check.png');
    await new Promise(r => setTimeout(r, 5000));
    
    // Emulate PRINT instead of screen so that the robust @media print CSS takes over
    await page.emulateMediaType('print');
    
    const pdfPath = '/home/govard/projects/7rl/domovey-projects/2026-08-18/Domovey_VKH_Presentation.pdf';
    await page.pdf({
        path: pdfPath,
        printBackground: true,
        preferCSSPageSize: true, // Use @page size from the CSS
        margin: { top: 0, right: 0, bottom: 0, left: 0 }
    });
    console.log(`Successfully saved to: ${pdfPath}`);
    
    await browser.close();
    console.log('Done!');
}

exportToPDF();
