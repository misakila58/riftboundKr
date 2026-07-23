// 공식 한글 룰(RUP4) 용어로 일괄 치환. 순서 중요(충돌 방지).
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
// [정규식, 치환] — 위에서부터 순서대로 적용
const MAP=[
  [/재충전/g,'재활용'],        // recycle (충전보다 먼저)
  [/충전/g,'전개'],            // channel
  [/무기의 달인/g,'무기의 대가'],// Weaponmaster
  [/속사/g,'빨리 뽑기'],        // Quick-Draw
  [/전투력/g,'위력'],          // Might
  [/파워/g,'힘'],              // Power
  [/소진/g,'탈진'],            // exhaust
  [/격돌/g,'결전'],            // Showdown
  [/점유/g,'유지'],            // Hold
  [/스턴/g,'기절'],            // Stun
  [/강습/g,'맹공'],            // Assault
  [/유언/g,'죽음의 종소리'],    // Deathknell
  [/갱킹/g,'개입'],            // Ganking
  [/은신/g,'숨겨짐'],          // Hidden
  [/시야/g,'통찰'],            // Vision
  [/강대/g,'위력적'],          // Mighty
  [/평온/g,'평정'],            // Calm
  [/본진/g,'기지'],            // base
  [/장비/g,'도구'],            // Gear
  [/일시(?!적)/g,'일시적'],     // Temporary
  [/시작 단계/g,'개시 단계'],   // Beginning phase
  [/속성/g,'영역'],            // domain
  [/파기 더미/g,'폐기장'],      // trash pile (먼저)
  [/파기/g,'폐기'],            // trash (verb)
  [/선택 챔피언/g,'선발 챔피언'],// Chosen Champion (공식 RUP4 표기)
];
const files=[
  ...['cards','loc','ui','engine','main','net','p2p','effects','cardscripts','tutorial','bot']
     .map(f=>`client/web/js/${f}.js`),
  'client/web/index.html',
  'tools/data/glossary.md',
  ...fs.readdirSync(path.join(ROOT,'tools/data')).filter(f=>/^tr_out_batch\d+\.json$/.test(f)).map(f=>`tools/data/${f}`),
];
let grand=0;
for(const rel of files){
  const fp=path.join(ROOT,rel);
  if(!fs.existsSync(fp)){ console.log('skip(없음):',rel); continue; }
  let s=fs.readFileSync(fp,'utf8'), before=s, n=0;
  for(const [re,to] of MAP){ s=s.replace(re,()=>{n++;return to;}); }
  if(s!==before){ fs.writeFileSync(fp,s); grand+=n; console.log(`${rel}: ${n}건`); }
}
console.log('총 치환:',grand,'건');
