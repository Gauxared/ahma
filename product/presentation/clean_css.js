const fs = require('fs');

const files = [
    '02_Cases_And_Social_Proof.html',
    '03_Sales_Playbook_Presentation_V2.html'
];

for (let file of files) {
    let content = fs.readFileSync(file, 'utf-8');
    
    // First, let's remove the broken parts
    const startIdx = content.indexOf('@media print {');
    const endIdx = content.indexOf('</style>');
    
    if (startIdx !== -1 && endIdx !== -1) {
        const cleanCSS = `
@media print {
  html, body { width: 1920px; height: 1080px; margin: 0; padding: 0; display: block !important; background: white !important; }
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
}

.layout-split { display: flex; height: 100%; min-height: 1080px; flex-direction: row; box-sizing: border-box; }
.layout-split .img-half { width: 50%; height: 100%; object-fit: cover; }
.layout-split .text-half { width: 50%; padding: 80px; display: flex; flex-direction: column; justify-content: center; }

.theme-dark { background: var(--black); color: var(--white); }
.theme-dark .text-muted { color: #888; }
.theme-dark .border-line { border-color: #333; }

.layout-matrix { display: flex; flex-direction: column; padding: 80px; height: 100%; min-height: 1080px; box-sizing: border-box; justify-content: flex-start; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 30px; margin-top: 30px; }
.grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 40px; margin-top: 30px; }

.layout-stats { display: flex; flex-direction: column; padding: 80px; height: 100%; min-height: 1080px; justify-content: center; align-items: center; text-align: center; box-sizing: border-box; }
.stat-huge { font-size: 240px; font-weight: 900; letter-spacing: -10px; line-height: 1.1; color: var(--red); margin: 30px 0; padding-bottom: 20px; }

h1 { font-size: 72px; font-weight: 800; letter-spacing: -2px; line-height: 1.1; margin-bottom: 20px; }
h2 { font-size: 52px; font-weight: 700; letter-spacing: -1px; margin-bottom: 20px; }
h3 { font-size: 32px; font-weight: 700; letter-spacing: -1px; margin-bottom: 15px; }
p { font-size: 22px; font-weight: 400; line-height: 1.5; margin-bottom: 20px; color: #444; }
.theme-dark p { color: #BBB; }
.text-muted { font-size: 24px; font-weight: 300; color: #666; margin-bottom: 30px; line-height: 1.4; }

ul.dense-list { list-style: none; margin-bottom: 30px; }
ul.dense-list li { font-size: 20px; line-height: 1.5; margin-bottom: 15px; padding-left: 30px; position: relative; color: #333; }
.theme-dark ul.dense-list li { color: #DDD; }
ul.dense-list li::before { content: '→'; position: absolute; left: 0; color: var(--red); font-weight: 800; font-size: 22px; }

.badge { display: inline-block; background: var(--red); color: white; padding: 10px 20px; font-size: 16px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; border-radius: 6px; margin-bottom: 20px; }
.badge-outline { background: transparent; border: 2px solid var(--red); color: var(--red); }
.theme-dark .badge-outline { border-color: #555; color: #FFF; }

.header-top { position: absolute; top: 60px; left: 100px; right: 100px; display: flex; justify-content: space-between; z-index: 10; }
.logo-text { font-size: 28px; font-weight: 900; letter-spacing: -1px; }
.logo-text span { color: var(--red); }
.slide-num { font-size: 24px; font-weight: 700; color: var(--red); }

.box { background: var(--gray-100); padding: 50px; border-radius: 16px; border: 1px solid #E5E5E5; display: flex; flex-direction: column; flex: 1; }
.theme-dark .box { background: var(--gray-900); border-color: #333; }

.grid-stretch { flex-grow: 1; display: grid; gap: 40px; margin-top: 40px; }
.grid-stretch-3 { grid-template-columns: repeat(3, 1fr); }
.grid-stretch-2 { grid-template-columns: repeat(2, 1fr); }
.quote-text { font-size: 38px; line-height: 1.5; font-style: italic; font-weight: 600; color: #444; }
.theme-dark .quote-text { color: #DDD; }
.author-block { display: flex; align-items: center; margin-top: 40px; gap: 20px; }
.author-avatar { width: 80px; height: 80px; border-radius: 50%; background: var(--red); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 24px; }
.author-info h4 { font-size: 28px; margin-bottom: 5px; }
.author-info p { font-size: 20px; color: #888; margin: 0; }

.slide::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: inherit;
  z-index: -1;
}
.slide { background-color: var(--white); }
.slide.theme-dark { background-color: var(--black); }
`;
        const newContent = content.substring(0, startIdx) + cleanCSS + '\n' + content.substring(endIdx);
        fs.writeFileSync(file, newContent);
    }
}

console.log("CSS syntax error completely fixed.");
