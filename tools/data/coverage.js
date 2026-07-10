const fs=require('fs');
const code = fs.readFileSync('../js/cards.js','utf8') + fs.readFileSync('../js/effects.js','utf8');
const body = code + `
const stats={full:0,partial:0,manual:0,none:0};
const manualCards=[];
compileAllCards();
CARDS.forEach(c=>{
  const fx=FX[c.n];
  const hasAuto=(fx.playOps&&fx.playOps.length)||(fx.activated&&fx.activated.length)||Object.keys(fx.triggers||{}).length||Object.keys(fx.kw||{}).length||fx.hookMightyPlay||fx.hookYouStun||fx.hookEnemyAttackMyBf||fx.hookBuffedDeathSave;
  if(!c.text){stats.none++;return;}
  if(!fx.manual.length && hasAuto){stats.full++;return;}
  if(fx.manual.length && hasAuto){stats.partial++;manualCards.push(c.n+':'+c.name);return;}
  stats.manual++; manualCards.push(c.n+':'+c.name+' [FULL-MANUAL]');
});
console.log(JSON.stringify(stats));
console.log('manual-needed cards:', manualCards.length);
console.log(manualCards.join(' | '));
`;
(new Function('console', body))(console);
