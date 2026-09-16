const fs = require('fs');
const file = '/home/govard/projects/7rl/stroyintellekt/product/presentation/01_Client_Pitch_Presentation.html';
let content = fs.readFileSync(file, 'utf8');

let slideCounter = 1;
content = content.replace(/<div class="slide-num">.*?<\/div>/g, () => {
    let numStr = slideCounter < 10 ? '0' + slideCounter : slideCounter.toString();
    slideCounter++;
    return `<div class="slide-num">${numStr}</div>`;
});

let commentCounter = 1;
content = content.replace(/<!-- СЛАЙД \d+(_NEW)?:/g, () => {
    let res = `<!-- СЛАЙД ${commentCounter}:`;
    commentCounter++;
    return res;
});

fs.writeFileSync(file, content);
console.log('Slides renumbered perfectly up to ' + (slideCounter - 1));
