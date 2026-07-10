// ══════════ 한글화 & 텍스트 렌더링 ══════════

// 키워드: 영문 → 한글 및 설명(자체 요약)
const KEYWORDS_KO = {
  'Accelerate': { ko:'가속',   desc:'플레이할 때 에너지 1 + 파워 1을 추가로 지불하면 준비 상태로 등장한다.' },
  'Action':     { ko:'행동',   desc:'격돌 중에도(상대 턴 포함) 플레이/발동할 수 있다.' },
  'Reaction':   { ko:'반응',   desc:'행동 타이밍에 더해, 체인이 있을 때도 플레이/발동할 수 있다.' },
  'Add':        { ko:'추가',   desc:'자원(에너지/파워)을 룬 풀에 추가한다.' },
  'Assault':    { ko:'강습',   desc:'공격자인 동안 전투력 +X.' },
  'Deathknell': { ko:'유언',   desc:'이 카드가 죽어 파기될 때 효과 발동.' },
  'Deflect':    { ko:'굴절',   desc:'상대의 주문/능력이 이 카드를 선택하려면 파워 X를 추가로 지불해야 한다.' },
  'Ganking':    { ko:'갱킹',   desc:'전장에서 다른 전장으로 이동할 수 있다.' },
  'Hidden':     { ko:'은신',   desc:'파워 1을 지불해 통제 중인 전장에 뒷면으로 숨겨두고, 다음 턴부터 기본 비용 없이 플레이할 수 있다.' },
  'Legion':     { ko:'군단',   desc:'이 턴에 다른 카드를 플레이했다면 효과를 얻는다.' },
  'Mighty':     { ko:'강대',   desc:'전투력이 5 이상인 상태.' },
  'Shield':     { ko:'보호막', desc:'방어자인 동안 전투력 +X.' },
  'Tank':       { ko:'탱커',   desc:'전투 피해 배분 시 치명 피해를 가장 먼저 배정받아야 한다.' },
  'Temporary':  { ko:'일시',   desc:'컨트롤러의 시작 단계(득점 전)에 처치된다.' },
  'Vision':     { ko:'시야',   desc:'플레이될 때 덱 맨 위 카드를 보고, 원하면 재충전(덱 맨 아래로)할 수 있다.' },
  'Equip':      { ko:'장착',   desc:'비용을 지불해 아군 유닛에 부착한다.' },
  'Quick-Draw': { ko:'속사',   desc:'[반응] 타이밍으로 플레이하며, 플레이 시 아군 유닛에 부착한다.' },
  'Repeat':     { ko:'반복',   desc:'추가 비용을 지불하면 주문 효과를 한 번 더 실행한다.' },
  'Weaponmaster':{ko:'무기의 달인', desc:'플레이 시 장비 하나를 할인된 비용으로 장착할 수 있다.' },
};
// 한글 키워드 → 영문 역방향
const KEYWORDS_EN = {};
Object.entries(KEYWORDS_KO).forEach(([en,v])=>KEYWORDS_EN[v.ko]=en);

const DOMAIN_KO = { Fury:'분노', Calm:'평온', Mind:'정신', Body:'신체', Order:'질서', Chaos:'혼돈', Colorless:'무색' };
const DOMAIN_ICON = { Fury:'🔥', Calm:'🍃', Mind:'💠', Body:'💪', Order:'⚖️', Chaos:'🌀', Colorless:'⚪', Any:'✳️' };
const DOMAIN_COLOR = { Fury:'#e06a4a', Calm:'#5ac88a', Mind:'#5a9de0', Body:'#e0a05a', Order:'#e8d88a', Chaos:'#b06ae0', Colorless:'#aab' };

const TYPE_KO = { Unit:'유닛', Spell:'주문', Gear:'장비', Rune:'룬', Battlefield:'전장', Legend:'전설' };
const SUPER_KO = { Champion:'챔피언', Token:'토큰', Signature:'시그니처', Basic:'기본' };
const RARITY_KO = { Common:'일반', Uncommon:'고급', Rare:'희귀', Epic:'서사', Legendary:'전설', Overnumbered:'특수' };

// 아이콘 토큰 → 표시용 HTML
function renderIcons(text){
  if(!text) return '';
  return text
    .replace(/:rb_might:/g, '<span class="icon-might">⚔</span>')
    .replace(/:rb_exhaust:/g, '<span class="icon-energy">⟳</span>')
    .replace(/:rb_energy_(\d+|x):/gi, '<span class="icon-energy">($1)</span>')
    .replace(/:rb_rune_rainbow:/g, '<span class="icon-rune" style="color:#d8a">✳</span>')
    .replace(/:rb_rune_fury:/g, `<span class="icon-rune" style="color:${DOMAIN_COLOR.Fury}">🔥</span>`)
    .replace(/:rb_rune_calm:/g, `<span class="icon-rune" style="color:${DOMAIN_COLOR.Calm}">🍃</span>`)
    .replace(/:rb_rune_mind:/g, `<span class="icon-rune" style="color:${DOMAIN_COLOR.Mind}">💠</span>`)
    .replace(/:rb_rune_body:/g, `<span class="icon-rune" style="color:${DOMAIN_COLOR.Body}">💪</span>`)
    .replace(/:rb_rune_order:/g, `<span class="icon-rune" style="color:${DOMAIN_COLOR.Order}">⚖️</span>`)
    .replace(/:rb_rune_chaos:/g, `<span class="icon-rune" style="color:${DOMAIN_COLOR.Chaos}">🌀</span>`)
    .replace(/\[([^\]]+)\]/g, '<span class="kw">[$1]</span>');
}

function esc(s){ const d=document.createElement('div'); d.textContent=s??''; return d.innerHTML; }

// 카드의 한글 타입 라인
function typeLine(c){
  let s = TYPE_KO[c.type]||c.type;
  if(c.super && SUPER_KO[c.super]) s = SUPER_KO[c.super]+' '+s;
  if(c.dom && c.dom.length) s += ' · ' + c.dom.map(d=>DOMAIN_KO[d]||d).join('/');
  if(c.rarity) s += ' · ' + (RARITY_KO[c.rarity]||c.rarity);
  return s;
}
