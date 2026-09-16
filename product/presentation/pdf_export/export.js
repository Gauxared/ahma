const puppeteer = require('puppeteer');
const path = require('path');

async function exportToPDF() {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Config
    const files = [
        '02_Cases_And_Social_Proof.html',
        '03_Sales_Playbook_Presentation_V2.html'
    ];
    
    for (const file of files) {
        try {
            const absolutePath = path.resolve(__dirname, file);
            console.log(`Processing: ${absolutePath}`);
            
            await page.goto(`file://${absolutePath}`, { waitUntil: 'networkidle0' });
            
            await page.emulateMediaType('screen');
            await page.addStyleTag({ content: 'body { margin: 0; padding: 0; background: white !important; } .slide { margin-bottom: 0 !important; border: none !important; box-shadow: none !important; }' });
            
            const pdfPath = absolutePath.replace('.html', '.pdf');
            await page.pdf({
                path: pdfPath,
                width: '1920px',
                height: '1080px',
                printBackground: true,
                margin: { top: 0, right: 0, bottom: 0, left: 0 }
            });
            console.log(`Successfully saved to: ${pdfPath}`);
        } catch (err) {
            console.log(`Error on ${file}: ${err.message}`);
        }
    }
    
    await browser.close();
    console.log('Done!');
}

exportToPDF();
