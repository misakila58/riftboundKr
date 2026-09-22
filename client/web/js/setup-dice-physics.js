// Local visual physics only: never consume the engine's seeded rng().
const SetupDicePhysics = (() => {
  const normals = [null, [0,0,1], [0,-1,0], [1,0,0], [-1,0,0], [0,1,0], [0,0,-1]];
  const vector = a => new CANNON.Vec3(...a);
  const step = 1/120;

  function topFace(q){
    let face=1, height=-Infinity;
    for(let n=1;n<=6;n++){
      const z=q.vmult(vector(normals[n])).z;
      if(z>height){face=n;height=z;}
    }
    return {face,height};
  }

  // Rotate the whole numbering scheme before playback, preserving opposite faces and handedness.
  function faceLabels(q,value){
    const rotation=new CANNON.Quaternion();
    rotation.setFromVectors(vector(normals[value]),vector(normals[topFace(q).face]));
    const labels=[];
    for(let label=1;label<=6;label++){
      const normal=rotation.vmult(vector(normals[label]));
      let face=1, alignment=-Infinity;
      for(let n=1;n<=6;n++){
        const dot=normal.dot(vector(normals[n]));
        if(dot>alignment){face=n;alignment=dot;}
      }
      labels[face]=label;
    }
    return labels;
  }

  function matrix(q){
    const {x,y,z,w}=q;
    return `matrix3d(${[
      1-2*(y*y+z*z),2*(x*y+z*w),2*(x*z-y*w),0,
      2*(x*y-z*w),1-2*(x*x+z*z),2*(y*z+x*w),0,
      2*(x*z+y*w),2*(y*z-x*w),1-2*(x*x+y*y),0,
      0,0,0,1,
    ].join(',')})`;
  }

  async function simulate(width,height,dice){
    const size=Math.min(68,width/6,height/6), w=width/size, h=height/size;
    // Retry only a genuinely cocked or unsettled throw; never force the body onto a face.
    for(let attempt=0;attempt<4;attempt++){
      const world=new CANNON.World({gravity:new CANNON.Vec3(0,0,-24),allowSleep:true});
      world.solver.iterations=12;
      world.defaultContactMaterial.friction=.38;
      world.defaultContactMaterial.restitution=.32;
      function plane(position,normal){
        const body=new CANNON.Body({mass:0,shape:new CANNON.Plane(),position:vector(position)});
        body.quaternion.setFromVectors(new CANNON.Vec3(0,0,1),vector(normal));
        world.addBody(body);
      }
      plane([0,0,0],[0,0,1]);
      // Invisible tray boundaries keep the entire die inside the screen.
      plane([.35,0,0],[1,0,0]); plane([w-.35,0,0],[-1,0,0]);
      plane([0,.35,0],[0,1,0]); plane([0,h-.35,0],[0,-1,0]);
      const tracks=dice.map(spec=>{
        const body=new CANNON.Body({mass:1,shape:new CANNON.Box(new CANNON.Vec3(.5,.5,.5)),
          allowSleep:true,sleepSpeedLimit:.12,sleepTimeLimit:.45,linearDamping:.12,angularDamping:.16});
        const direction=spec.mine?-1:1;
        body.position.set(w*(spec.mine?.76:.24),h*(spec.mine?.76:.24),2+Math.random()*1.6);
        body.velocity.set(direction*(2+Math.random()*3),direction*(2+Math.random()*3),1+Math.random()*2);
        body.angularVelocity.set((Math.random()-.5)*24,(Math.random()-.5)*24,(Math.random()-.5)*18);
        body.quaternion.setFromEuler(Math.random()*Math.PI*2,Math.random()*Math.PI*2,Math.random()*Math.PI*2);
        return {...spec,body,frames:[],spawn:Math.round(spec.delay/1000/step),added:false};
      });
      let settled=false;
      const impacts=[], lastImpact=new Map();
      for(let tick=0;tick<1200;tick++){
        for(const track of tracks){
          if(tick===track.spawn){world.addBody(track.body);track.added=true;}
        }
        // Contact-point velocity includes rotation: a rolling corner can strike without a large fall.
        const velocities=new Map(tracks.filter(t=>t.added).map(t=>[t.body.id,
          {linear:t.body.velocity.clone(),angular:t.body.angularVelocity.clone()}]));
        world.step(step);
        const contacts=new Map();
        for(const c of world.contacts){
          const velocity=(body,r)=>{
            const v=velocities.get(body.id);
            if(!v) return new CANNON.Vec3();
            return v.angular.cross(r).vadd(v.linear);
          };
          const speed=Math.max(0,c.ni.dot(velocity(c.bi,c.ri).vsub(velocity(c.bj,c.rj))));
          const key=[c.bi.id,c.bj.id].sort((a,b)=>a-b).join(':');
          const previous=contacts.get(key);
          const count=(previous?.count||0)+1;
          if(previous && previous.speed>=speed){previous.count=count;continue;}
          const point=c.bi.position.vadd(c.ri);
          contacts.set(key,{speed,count,x:Math.max(-1,Math.min(1,point.x/w*2-1)),
            surface:c.bi.mass && c.bj.mass?'dice':Math.abs(c.ni.z)>.5?'floor':'wall'});
        }
        for(const [key,hit] of contacts){
          const time=tick*step*1000;
          if(hit.speed<.45 || time-(lastImpact.get(key)??-Infinity)<45) continue;
          lastImpact.set(key,time);
          impacts.push({time,speed:hit.speed,x:hit.x,surface:hit.surface,edge:hit.count<3});
        }
        for(const track of tracks){
          if(!track.added) continue;
          const {position,quaternion}=track.body;
          track.frames.push({x:position.x*size,y:position.y*size,
            height:Math.max(0,(position.z-.5)*size),rotation:matrix(quaternion)});
        }
        if(tracks.every(t=>t.added&&t.body.sleepState===CANNON.Body.SLEEPING)){
          settled=tracks.every(t=>topFace(t.body.quaternion).height>.995);
          break;
        }
        // Let input/paint run during precomputation on slower devices.
        if(tick%240===239) await new Promise(resolve=>setTimeout(resolve,0));
      }
      if(settled) return {size,step:step*1000,impacts,tracks:tracks.map(t=>({
        p:t.p,value:t.value,mine:t.mine,delay:t.delay,frames:t.frames,
        labels:faceLabels(t.body.quaternion,t.value),top:topFace(t.body.quaternion).face,
      }))};
    }
    throw new Error('Setup dice did not settle');
  }
  return {simulate};
})();
