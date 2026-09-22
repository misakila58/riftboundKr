// Solid plastic-die impacts. Audio randomness never touches game rng().
(() => {
  const voices=new Set(), banks=new Map();
  let context=null, output=null;
  function makeImpact(ctx,surface){
    const duration=.18, rate=ctx.sampleRate;
    const buffer=ctx.createBuffer(1,Math.ceil(rate*duration),rate), data=buffer.getChannelData(0);
    const hard=surface==='dice', pitch=.96+Math.random()*.08;
    const modes=(hard?[95,190,360,580]:[70,140,280,470]).map((hz,i)=>
      ({hz:hz*pitch*(.97+Math.random()*.06),gain:.15/Math.pow(1.55,i),
        decay:(hard?.028:.034)/Math.pow(1.35,i)}));
    let low=0, body=0, peak=0;
    for(let i=0;i<data.length;i++){
      const t=i/rate, noise=Math.random()*2-1;
      low+=.62*(noise-low); body+=.14*(noise-body);
      // Soften the sharp click and give the solid body a short, lower-frequency thud.
      const snap=(low-body)*Math.exp(-t/(hard?.0012:.0018))*.12;
      const texture=(low-body*.35)*Math.exp(-t/.007)*.07;
      let value=snap+texture;
      for(const mode of modes) value+=mode.gain*Math.sin(2*Math.PI*mode.hz*t)*Math.exp(-t/mode.decay);
      value*=Math.min(1,t/.00015);
      data[i]=value; peak=Math.max(peak,Math.abs(value));
    }
    const scale=.75/Math.max(.01,peak);
    for(let i=0;i<data.length;i++) data[i]*=scale;
    return buffer;
  }
  UI.prepareDiceAudio=()=>{
    if(!SFX.on) return null;
    const ctx=SFX.ctx(); if(!ctx) return null;
    if(context!==ctx){
      context=ctx; banks.clear();
      output=ctx.createDynamicsCompressor();
      output.threshold.value=-12; output.knee.value=12; output.ratio.value=3;
      output.attack.value=.002; output.release.value=.08;
      output.connect(ctx.destination);
    }
    for(const surface of ['floor','wall','dice']) if(!banks.has(surface))
      banks.set(surface,Array.from({length:6},()=>makeImpact(ctx,surface)));
    return ctx;
  };
  UI.stopDiceAudio=()=>{
    for(const voice of [...voices]) voice.stop();
  };
  const setSoundOn=SFX.setOn;
  SFX.setOn=function(on){setSoundOn.call(SFX,on);if(!on) UI.stopDiceAudio();};
  UI.playDiceImpact=hit=>{
    if(!SFX.on || document.hidden) return;
    const ctx=UI.prepareDiceAudio(); if(!ctx || ctx.state!=='running') return;
    const bank=banks.get(hit.surface); if(!bank) return;
    // Gentle late bounces remain audible; strong simultaneous impacts are limited by the bus.
    const strength=Math.min(1,Math.pow(Math.max(0,hit.speed)/8,.8));
    const source=ctx.createBufferSource(), gain=ctx.createGain(), filter=ctx.createBiquadFilter();
    const pan=typeof ctx.createStereoPanner==='function'?ctx.createStereoPanner():ctx.createGain();
    source.buffer=bank[Math.floor(Math.random()*bank.length)];
    source.playbackRate.value=(hit.surface==='wall'?1.06:1)*(.97+Math.random()*.06);
    filter.type='lowpass'; filter.frequency.value=(hit.edge?520:350)+strength*250; filter.Q.value=.35;
    gain.gain.value=.22*strength;
    if(pan.pan) pan.pan.value=hit.x*.8;
    source.connect(filter); filter.connect(gain); gain.connect(pan); pan.connect(output);
    const voice={stop(){try{source.stop();}catch{} cleanup();}};
    const cleanup=()=>{ voices.delete(voice); source.disconnect();filter.disconnect();gain.disconnect();pan.disconnect(); };
    source.onended=cleanup; voices.add(voice); source.start();
  };
  // Unlock on a real gesture, including mobile and the first setup hold/click.
  const unlock=()=>{if(SFX.on) UI.prepareDiceAudio();};
  window.addEventListener('pointerdown',unlock,{passive:true});
  window.addEventListener('keydown',unlock);
  document.addEventListener('visibilitychange',()=>{if(document.hidden) UI.stopDiceAudio();});
})();
