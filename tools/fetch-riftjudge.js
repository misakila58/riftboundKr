// RiftJudge(app.riftjudge.com) 공개 Q&A 전체를 받아 tools/data/riftjudge.jsonl 로 저장한다 (룰 판정 대조용, gitignore).
// 사용: node tools/fetch-riftjudge.js [maxId]   — 이미 받은 id는 건너뛴다(재개 가능). 동시 4개·요청 간 150ms로 예의를 지킨다.
const fs=require('fs'), path=require('path');
const OUT=path.join(__dirname,'data','riftjudge.jsonl');
const MAX=+process.argv[2]||11400, CONC=4, GAP=150;
const have=new Set();
if(fs.existsSync(OUT)) for(const l of fs.readFileSync(OUT,'utf8').split('\n')) if(l.trim()){ try{ have.add(JSON.parse(l).id); }catch(e){} }
const ids=[]; for(let i=1;i<=MAX;i++) if(!have.has(i)) ids.push(i);
console.log(`받을 id: ${ids.length}개 (이미 ${have.size}개)`);
const out=fs.createWriteStream(OUT,{flags:'a'});
let done=0, miss=0, fail=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function worker(){
  while(ids.length){
    const id=ids.shift();
    for(let a=0;a<3;a++){
      try{
        const r=await fetch(`https://app.riftjudge.com/api/questions/${id}`);
        if(r.status===404){ miss++; out.write(JSON.stringify({id,missing:true})+'\n'); break; }
        if(!r.ok) throw new Error('HTTP '+r.status);
        const j=await r.json();
        out.write(JSON.stringify({id, question:j.question, answer:j.answer, status:j.status, deprecated:j.deprecated, tags:j.tags, rule_refs:j.rule_refs, created_at:j.created_at, vote_score:j.vote_score, corrections:j.corrections})+'\n');
        done++; break;
      }catch(e){ if(a===2){ fail++; console.log('실패',id,e.message); } await sleep(1000*(a+1)); }
    }
    if((done+miss)%500===0) console.log(`진행 ${done+miss} (없음 ${miss}, 실패 ${fail})`);
    await sleep(GAP);
  }
}
Promise.all(Array.from({length:CONC},worker)).then(()=>{ out.end(); console.log(`완료: 저장 ${done}, 없음 ${miss}, 실패 ${fail} → ${OUT}`); });
