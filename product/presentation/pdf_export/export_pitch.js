const puppeteer = require('puppeteer');
const path = require('path');

async function exportToPDF() {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    const files = [
        '../01_Client_Pitch_Presentation3.html'
    ];
    
    for (const file of files) {
        try {
            const absolutePath = path.resolve(__dirname, file);
            console.log(`Processing: ${absolutePath}`);
            
            await page.goto(`file://${absolutePath}`, { waitUntil: 'networkidle0' });
            
            // Emulate PRINT instead of screen so that the robust @media print CSS takes over
            await page.emulateMediaType('print');
            
            const pdfPath = absolutePath.replace('.html', '.pdf');
            await page.pdf({
                path: pdfPath,
                printBackground: true,
                preferCSSPageSize: true, // Use @page size from the CSS
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
