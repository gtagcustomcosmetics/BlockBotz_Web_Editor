(function(){
  "use strict";
  var VOTE_MS=20000;
  var state={peer:null,connections:[],isHost:false,name:"Builder",color:"#55d6ff",scene:null,camera:null,markers:{},isApplyingRemote:false,lastPresence:0,imported:[],vote:null,ui:null};
  var api=window.BlockbotzCollab={
    isApplyingRemote:false,
    init:function(ctx){ state.scene=ctx.scene; state.camera=ctx.camera; setupUI(); autoJoin(); },
    broadcastLevel:function(level){ if(state.isApplyingRemote) return; sendAll({type:"level",level:level}); },
    inRoom:function(){ return openConns().length>0; },
    requestSwitch:function(label,level){
      if(!api.inRoom()||!level) return false;
      var req={type:"vote-request",id:uid(),label:String(label||"a new map").slice(0,60),level:level,name:state.name};
      if(state.isHost) hostStartVote(req,state.peer.id,state.name); else sendToHost(req);
      return true;
    },
    addImported:function(name,level){
      var m=cleanMap({id:uid(),name:name,by:state.name,level:level}); if(!m) return;
      addImportedMap(m);
      var msg={type:"imported-add",map:m};
      if(state.isHost) sendAll(msg); else sendToHost(msg);
    },
    updateLocalPresence:function(camera){
      if(!state.connections.length) return;
      var now=performance.now(); if(now-state.lastPresence<80) return; state.lastPresence=now;
      var f=new THREE.Vector3(); camera.getWorldDirection(f);
      sendAll({type:"presence",name:state.name,color:state.color,pos:{x:camera.position.x,y:camera.position.y,z:camera.position.z},dir:{x:f.x,y:f.y,z:f.z}});
    }
  };
  function setupUI(){
    var create=document.getElementById("collab-create"), copy=document.getElementById("collab-copy"), name=document.getElementById("collab-name"), link=document.getElementById("collab-link");
    if(!create) return;
    create.onclick=function(){ var cc=document.getElementById("collab-color"); if(cc) state.color=safeColor(cc.value); state.name=(name.value||"Builder").trim().slice(0,24)||"Builder"; createRoom(); };
    copy.onclick=function(){ if(link.value) navigator.clipboard&&navigator.clipboard.writeText(link.value); };
    var close=document.getElementById("collab-modal-close");
    if(close) close.addEventListener("click",function(){
      var modal=document.getElementById("collab-modal");
      if(modal) modal.classList.remove("open");
    });
    var modal=document.getElementById("collab-modal");
    if(modal) modal.addEventListener("click",function(e){
      if(e.target===modal) modal.classList.remove("open");
    });
  }
  function status(t){ var el=document.getElementById("collab-status"); if(el) el.innerHTML=t; }
  function createRoom(){
    if(!window.Peer){ status("<strong>Collaboration library failed to load.</strong>"); return; }
    if(state.peer) state.peer.destroy();
    state.isHost=true;
    state.peer=new Peer();
    state.peer.on("open",function(id){
      var url=new URL(location.href); url.searchParams.set("room",id);
      document.getElementById("collab-link").value=url.href; document.getElementById("collab-copy").disabled=false;
      status("<strong>Room ready.</strong><br><br>Send the link to your friend. When they join, their builder marker will appear in your scene.");
    });
    state.peer.on("connection",setupConnection);
    state.peer.on("error",function(e){ status("<strong>Room error:</strong> "+(e.type||"connection error")); });
  }
  function safeColor(c){ return /^#[0-9a-f]{6}$/i.test(c||"")?c:"#55d6ff"; }
  function autoJoin(){
    var room=new URLSearchParams(location.search).get("room"); if(!room || !window.Peer) return;
    showJoinDialog(function(name,color){
      state.name=name; state.color=color; state.isHost=false;
      state.peer=new Peer();
      state.peer.on("open",function(){ setupConnection(state.peer.connect(room)); });
    });
  }
  function showJoinDialog(onJoin){
    var ov=document.createElement("div"); ov.className="modal-overlay open";
    ov.innerHTML='<div class="modal"><div class="modal-head"><span>Join Room</span></div><div class="modal-body">'+
      '<div class="collab-status"><strong>Pick your builder name and color.</strong></div>'+
      '<div class="save-form" style="margin-top:12px"><input id="join-name" maxlength="24" placeholder="Your builder name" value="Builder">'+
      '<input type="color" id="join-color" value="#55d6ff" title="Your color" style="width:42px;height:34px;padding:2px;flex:none;cursor:pointer">'+
      '<button class="btn primary" id="join-go">Join</button></div></div></div>';
    document.body.appendChild(ov);
    var nameEl=ov.querySelector("#join-name"), colorEl=ov.querySelector("#join-color");
    function go(){
      var name=(nameEl.value||"Builder").trim().slice(0,24)||"Builder";
      var color=safeColor(colorEl.value);
      document.body.removeChild(ov); onJoin(name,color);
    }
    ov.querySelector("#join-go").onclick=go;
    nameEl.addEventListener("keydown",function(e){ e.stopPropagation(); if(e.key==="Enter") go(); });
    nameEl.focus(); nameEl.select();
  }
  function setupConnection(conn){
    state.connections.push(conn);
    conn.on("open",function(){
      // Only the host sends its level on hello. If both sides did, the host's
      // map would be replaced by the newcomer's blank level the moment they join.
      var hello={type:"hello",name:state.name,color:state.color};
      if(state.isHost){ hello.level=window.BlockbotzGetLevel?window.BlockbotzGetLevel():{objects:[]}; hello.imported=state.imported; }
      conn.send(hello);
      status("<strong>Connected.</strong><br><br>Collaboration is active. Your friend's ball and facing arrow will appear in the 3D view.");
      roomUI();
    });
    conn.on("data",function(msg){
      if(!msg||!msg.type) return;
      var t=msg.type;
      if(t==="hello"){
        if(msg.level) applyRemoteLevel(msg.level);
        if(Array.isArray(msg.imported)) msg.imported.forEach(function(m){ var c=cleanMap(m); if(c) addImportedMap(c); });
      }
      else if(t==="level"&&msg.level){ applyRemoteLevel(msg.level); if(state.isHost) relay(conn,msg); }
      else if(t==="presence"){
        updateMarker(state.isHost?conn.peer:(msg.from||conn.peer),msg);
        if(state.isHost){ var r={}; for(var k in msg) r[k]=msg[k]; r.from=conn.peer; relay(conn,r); }
      }
      else if(t==="left") removeMarker(msg.peer);
      else if(t==="imported-add"){ var cm=cleanMap(msg.map); if(cm){ addImportedMap(cm); if(state.isHost) relay(conn,{type:"imported-add",map:cm}); } }
      else if(t==="vote-request"&&state.isHost){ if(msg.level&&Array.isArray(msg.level.objects)) hostStartVote(msg,conn.peer,String(msg.name||"Builder").slice(0,24)); }
      else if(t==="vote-cast"&&state.isHost){
        if(state.vote&&state.vote.id===msg.id&&(msg.vote==="yes"||msg.vote==="no")){ state.vote.votes[conn.peer]=msg.vote; tally(); }
      }
      else if(t==="vote-start"&&!state.isHost){ if(msg.level&&Array.isArray(msg.level.objects)) showVote(msg); }
      else if(t==="vote-update"&&!state.isHost) updateVote(msg);
      else if(t==="vote-result"&&!state.isHost) endVote(msg);
      else if(t==="vote-denied") toast(String(msg.msg||"Could not start the vote."));
    });
    conn.on("close",function(){
      removeMarker(conn.peer);
      state.connections=state.connections.filter(function(c){return c!==conn;});
      if(state.isHost){
        sendAll({type:"left",peer:conn.peer});
        if(state.vote){
          delete state.vote.votes[conn.peer];
          if(state.vote.from===conn.peer) finishVote(false,"the person who started it left"); else tally();
        }
      } else closeVoteUI();
      roomUI();
    });
  }
  function openConns(){ return state.connections.filter(function(c){return c.open;}); }
  function sendAll(msg){ state.connections.slice().forEach(function(c){ if(c.open) try{c.send(msg);}catch(e){} }); }
  function sendToHost(msg){ var c=openConns()[0]; if(c) try{c.send(msg);}catch(e){} }
  function relay(from,msg){ state.connections.slice().forEach(function(c){ if(c!==from&&c.open) try{c.send(msg);}catch(e){} }); }
  function uid(){ return Math.random().toString(36).slice(2,10)+Date.now().toString(36); }
  function esc(t){ return String(t).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function toast(m){ if(window.BlockbotzUI&&window.BlockbotzUI.toast) window.BlockbotzUI.toast(m); }
  function roomUI(){ if(window.BlockbotzUI&&window.BlockbotzUI.setRoomActive) window.BlockbotzUI.setRoomActive(api.inRoom()); }
  function applyRemoteLevel(level){
    if(!level||!window.BlockbotzSetLevel) return;
    state.isApplyingRemote=true; api.isApplyingRemote=true;
    try{ window.BlockbotzSetLevel(level); } finally { state.isApplyingRemote=false; api.isApplyingRemote=false; }
  }

  /* ---------- shared Imported Maps ---------- */
  function cleanMap(m){
    if(!m||typeof m.id!=="string"||!m.level||!Array.isArray(m.level.objects)) return null;
    return {id:m.id.slice(0,40),name:String(m.name||"Imported map").slice(0,60),by:String(m.by||"Builder").slice(0,24),count:m.level.objects.length,level:{objects:m.level.objects}};
  }
  function addImportedMap(m){
    if(state.imported.some(function(x){return x.id===m.id;})) return;
    state.imported.push(m);
    if(state.imported.length>25) state.imported.shift();
    if(window.BlockbotzUI&&window.BlockbotzUI.setImported) window.BlockbotzUI.setImported(state.imported.slice());
  }

  /* ---------- majority vote before replacing the whole level ----------
     The host counts votes. The person who starts it begins as a Yes and can
     flip to No. Majority of everyone in the room decides; no majority in 20s cancels. */
  function hostStartVote(req,fromPeer,fromName){
    if(state.vote){
      if(fromPeer===state.peer.id) toast("A vote is already in progress.");
      else { var c=state.connections.filter(function(x){return x.peer===fromPeer;})[0]; if(c&&c.open) try{c.send({type:"vote-denied",msg:"A vote is already in progress."});}catch(e){} }
      return;
    }
    var v={id:String(req.id||uid()).slice(0,40),label:String(req.label||"a new map").slice(0,60),level:req.level,from:fromPeer,fromName:fromName,votes:{},timer:null};
    v.votes[fromPeer]="yes";
    v.timer=setTimeout(function(){ finishVote(false,"time ran out"); },VOTE_MS);
    state.vote=v;
    var start={type:"vote-start",id:v.id,label:v.label,level:v.level,from:fromPeer,fromName:fromName,ms:VOTE_MS};
    sendAll(start); showVote(start); tally();
  }
  function tally(){
    var v=state.vote; if(!v) return;
    var total=openConns().length+1, yes=0, no=0;
    Object.keys(v.votes).forEach(function(k){ if(v.votes[k]==="yes") yes++; else no++; });
    var need=Math.floor(total/2)+1;
    var upd={type:"vote-update",id:v.id,yes:yes,no:no,total:total,need:need};
    sendAll(upd); updateVote(upd);
    if(yes>=need) finishVote(true); else if(no>total-need) finishVote(false,"majority voted no");
  }
  function finishVote(passed,reason){
    var v=state.vote; if(!v) return;
    clearTimeout(v.timer); state.vote=null;
    var res={type:"vote-result",id:v.id,passed:passed,reason:reason||""};
    sendAll(res); endVote(res);
  }
  function castVote(id,choice){
    if(state.isHost){ if(state.vote&&state.vote.id===id){ state.vote.votes[state.peer.id]=choice; tally(); } }
    else sendToHost({type:"vote-cast",id:id,vote:choice});
  }
  function showVote(start){
    closeVoteUI();
    var mine=state.peer&&start.from===state.peer.id;
    var ov=document.createElement("div"); ov.className="modal-overlay open";
    ov.innerHTML='<div class="modal"><div class="modal-head"><span>Switch map?</span></div><div class="modal-body">'+
      '<div class="collab-status"><strong>'+esc(start.fromName)+'</strong> wants to load <strong>'+esc(start.label)+'</strong>.<br><br>This replaces the current level for everyone.'+(mine?' You started this vote. Press No if it was a mistake.':'')+'</div>'+
      '<div class="save-note" id="vote-tally" style="margin-top:10px"></div>'+
      '<div class="save-form" style="margin-top:12px"><button class="btn" id="vote-yes" style="flex:1">Yes</button><button class="btn" id="vote-no" style="flex:1">No</button></div></div></div>';
    document.body.appendChild(ov);
    var ui={id:start.id,level:start.level,overlay:ov,choice:mine?"yes":null,deadline:Date.now()+(start.ms||VOTE_MS),last:null,timer:null};
    state.ui=ui;
    var yesB=ov.querySelector("#vote-yes"), noB=ov.querySelector("#vote-no");
    function paint(){ yesB.classList.toggle("primary",ui.choice==="yes"); noB.classList.toggle("danger",ui.choice==="no"); }
    yesB.addEventListener("click",function(){ if(state.ui!==ui) return; ui.choice="yes"; paint(); castVote(ui.id,"yes"); });
    noB.addEventListener("click",function(){ if(state.ui!==ui) return; ui.choice="no"; paint(); castVote(ui.id,"no"); });
    paint(); renderTally();
    ui.timer=setInterval(renderTally,500);
  }
  function renderTally(){
    var ui=state.ui; if(!ui) return;
    var el=ui.overlay.querySelector("#vote-tally"); if(!el) return;
    var secs=Math.max(0,Math.ceil((ui.deadline-Date.now())/1000));
    var u=ui.last;
    el.textContent=(u?("Yes "+u.yes+" · No "+u.no+" · "+u.need+" of "+u.total+" needed · "):"")+secs+"s left";
  }
  function updateVote(u){ var ui=state.ui; if(!ui||ui.id!==u.id) return; ui.last=u; renderTally(); }
  function endVote(res){
    var ui=state.ui; if(!ui||ui.id!==res.id) return;
    state.ui=null; clearInterval(ui.timer);
    ["#vote-yes","#vote-no"].forEach(function(q){ var b=ui.overlay.querySelector(q); if(b) b.disabled=true; });
    var el=ui.overlay.querySelector("#vote-tally");
    if(el) el.textContent=res.passed?"Vote passed. Loading the map...":"Vote failed"+(res.reason?" ("+res.reason+")":"")+". Nothing changed.";
    if(res.passed) applyRemoteLevel(ui.level);
    setTimeout(function(){ if(ui.overlay.parentNode) ui.overlay.parentNode.removeChild(ui.overlay); },res.passed?900:1600);
  }
  function closeVoteUI(){
    var ui=state.ui; if(!ui) return;
    clearInterval(ui.timer); if(ui.overlay.parentNode) ui.overlay.parentNode.removeChild(ui.overlay); state.ui=null;
  }
  function makeLabel(text){
    var c=document.createElement("canvas"); c.width=512; c.height=128;
    var g=c.getContext("2d");
    g.font="bold 56px system-ui, Arial, sans-serif"; g.textAlign="center"; g.textBaseline="middle";
    var w=Math.min(g.measureText(text).width+48,500);
    g.fillStyle="rgba(13,17,23,0.78)"; g.fillRect(256-w/2,22,w,84);
    g.fillStyle="#ffffff"; g.fillText(text,256,66,w-32);
    var tex=new THREE.CanvasTexture(c);
    var sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));
    sp.scale.set(2.4,.6,1); sp.position.set(0,1.15,0); sp.renderOrder=999;
    return sp;
  }
  function setLabel(m,text){
    text=String(text||"Builder").slice(0,24);
    if(m.name===text) return; m.name=text;
    if(m.label){ m.group.remove(m.label); if(m.label.material.map) m.label.material.map.dispose(); m.label.material.dispose(); }
    m.label=makeLabel(text); m.group.add(m.label);
  }
  function applyColor(m,hex){ if(m.color===hex) return; m.color=hex; m.ball.material.color.set(hex); m.arrow.setColor(hex); }
  function updateMarker(id,msg){
    if(!state.scene) return; var m=state.markers[id];
    if(!m){
      var group=new THREE.Group();
      var ball=new THREE.Mesh(new THREE.SphereGeometry(.35,16,12),new THREE.MeshBasicMaterial({color:0x55d6ff}));
      var arrow=new THREE.ArrowHelper(new THREE.Vector3(0,0,-1),new THREE.Vector3(0,0,0),1.1,0x55d6ff,.22,.12);
      group.add(ball); group.add(arrow); state.scene.add(group); m={group:group,arrow:arrow,ball:ball,label:null,name:null,color:null}; state.markers[id]=m;
    }
    setLabel(m,msg.name);
    applyColor(m,safeColor(msg.color));
    m.group.position.set(msg.pos.x,msg.pos.y,msg.pos.z);
    m.arrow.setDirection(new THREE.Vector3(msg.dir.x,msg.dir.y,msg.dir.z).normalize());
  }
  function removeMarker(id){ var m=state.markers[id]; if(!m) return; state.scene.remove(m.group); if(m.label){ if(m.label.material.map) m.label.material.map.dispose(); m.label.material.dispose(); } delete state.markers[id]; }
})();
