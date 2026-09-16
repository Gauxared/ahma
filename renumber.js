const fs = require('fs');
const file = '/home/govard/projects/7rl/stroyintellekt/product/presentation/01_Client_Pitch_Presentation.html';
let content = fs.readFileSync(file, 'utf8');
let counter = 1;
content = content.replace(/<div class="slide-num">.*?<\/div>/g, () => {
  let c = counter++;
  return `<div class="slide-num">${c < 10 ? '0' + c : c}</div>`;
});
fs.writeFileSync(file, content);
console.log('Renumbered to ' + (counter - 1));
