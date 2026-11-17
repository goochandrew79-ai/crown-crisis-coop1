'use strict';
// Crown Crisis co-op: a deliberately dependency-free Node HTTP + WebSocket relay.
// The room creator runs the original game simulation. The relay never trusts a
// guest-provided sender id, and only accepts state snapshots from the room host.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const rooms = new Map();
const clients = new Map();
let nextId = 0;
// V39: short outages also preserve pre-game lobbies and invite codes.
// Rooms are still ephemeral: a Render restart or a lost host browser can't restore a match.
const RECONNECT_GRACE_MS = 120000;

// Endless Survival hall of fame. Memory works with zero setup; optionally use
// free Upstash Redis REST for storage that survives Render free-service restarts.
const REDIS_URL=(process.env.UPSTASH_REDIS_REST_URL||'').replace(/\/$/,'');
const REDIS_TOKEN=process.env.UPSTASH_REDIS_REST_TOKEN||'';
const boardEnabled=!!(REDIS_URL&&REDIS_TOKEN);
const BOARD_KEY='crowncrisis:v31:survival:top100'; // Keep existing Upstash leaderboard records
let memoryBoard=[];
const lastPost=new Map();
function cleanName(s){return typeof s==='string'?(s.replace(/[<>\x00-\x1f]/g,'').trim().slice(0,18)||'Operative'):'Operative'}
function asInt(value,min,max){let n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):min}
function sortBoard(list){return list.sort((a,b)=>b.wave-a.wave||b.score-a.score||Date.parse(a.at)-Date.parse(b.at)).slice(0,100)}
async function redisCmd(args){
  const reply=await fetch(REDIS_URL,{method:'POST',headers:{Authorization:'Bearer '+REDIS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(6000)});
  if(!reply.ok)throw Error('database returned HTTP '+reply.status);
  const body=await reply.json();if(body.error)throw Error(body.error);return body.result;
}
async function loadScores(){
  if(!boardEnabled)return {entries:memoryBoard,persistent:false};
  try{const raw=await redisCmd(['GET',BOARD_KEY]);const entries=JSON.parse(raw||'[]');if(!Array.isArray(entries))throw Error('invalid leaderboard');memoryBoard=sortBoard(entries);return {entries:memoryBoard,persistent:true};}
  catch(err){console.error('Leaderboard storage offline:',err.message);return {entries:memoryBoard,persistent:false};}
}
async function saveScore(data){
  const entry={id:String(data.id||crypto.randomUUID()).replace(/[^A-Za-z0-9_-]/g,'').slice(0,64),mode:data.mode==='coop'?'coop':'solo',difficulty:['normal','hard','insanity'].includes(data.difficulty)?data.difficulty:'normal',name:cleanName(data.name),wave:asInt(data.wave,1,100000),cleared:asInt(data.cleared,0,100000),score:asInt(data.score,0,1e12),kills:asInt(data.kills,0,1e8),players:Array.isArray(data.players)?data.players.slice(0,4).map(cleanName):[cleanName(data.name)],at:new Date().toISOString()};
  if(!entry.id)entry.id=crypto.randomUUID();
  const prior=await loadScores();
  if(prior.entries.some(e=>e.id===entry.id))return {ok:true,persistent:prior.persistent};
  memoryBoard=sortBoard([...prior.entries,entry]);
  if(!boardEnabled)return {ok:true,persistent:false};
  try{await redisCmd(['SET',BOARD_KEY,JSON.stringify(memoryBoard)]);return {ok:true,persistent:true};}
  catch(err){console.error('Unable to persist score:',err.message);return {ok:true,persistent:false};}
}
function sendJSON(res,code,obj){res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'same-origin'});res.end(JSON.stringify(obj));}


const server = http.createServer((req, res) => {
  let pathname = '/';
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { res.writeHead(400).end(); return; }
  if (pathname === '/api/leaderboard' && req.method==='GET') {loadScores().then(b=>sendJSON(res,200,b)).catch(()=>sendJSON(res,503,{entries:[],persistent:false}));return;}
  if (pathname === '/api/leaderboard' && req.method==='POST') {
    const ip=req.socket.remoteAddress||'unknown',now=Date.now();
    if(now-(lastPost.get(ip)||0)<3000){sendJSON(res,429,{error:'Wait a few seconds before submitting again.'});return;}
    let body='',size=0;
    req.on('data',part=>{size+=part.length;if(size<=4096)body+=part.toString();else {req.destroy();}});
    req.on('end',()=>{try{const info=JSON.parse(body);if(info.mode!=='solo'||!Number.isFinite(Number(info.wave))||!Number.isFinite(Number(info.score)))throw Error('Invalid solo run');lastPost.set(ip,Date.now());
      saveScore(info).then(r=>sendJSON(res,200,r)).catch(()=>sendJSON(res,503,{error:'Could not store score'}));
    }catch(err){sendJSON(res,400,{error:'Invalid submission'});}});return;
  }
  if (pathname === '/health') { res.writeHead(200, {'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,rooms:rooms.size}));return; }
  if (pathname !== '/' && pathname !== '/index.html') {res.writeHead(404).end('Not found');return;}
  fs.readFile(path.join(ROOT,'index.html'), (err, data) => {
    if (err) {res.writeHead(500).end('Game not installed');return;}
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(data);
  });
});
function encodeFrame(payload, opcode=1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const len = data.length;
  let head;
  if (len < 126) {head=Buffer.alloc(2);head[1]=len;}
  else if (len < 65536) {head=Buffer.alloc(4);head[1]=126;head.writeUInt16BE(len,2);}
  else {head=Buffer.alloc(10);head[1]=127;head.writeBigUInt64BE(BigInt(len),2);}
  head[0]=0x80|opcode;
  return Buffer.concat([head,data]);
}
function send(client, obj) {
  if (!client || !client.socket || client.socket.destroyed) return;
  try {
    const str=JSON.stringify(obj);
    if (client.socket.writableLength > 1000000) return; // drop a slow spectator frame
    client.socket.write(encodeFrame(str));
  } catch {}
}
function relayRaw(client, str){
  if(!client||!client.socket||client.socket.destroyed||client.socket.writableLength>180000)return;
  try {client.socket.write(encodeFrame(str));}catch{}
}
function notify(room, obj, except) {for(const c of room.members.values())if(c!==except)send(c,obj);}
function roster(room){return {type:'roster',room:room.code,hostId:room.hostId,started:room.started,difficulty:room.difficulty||'normal',matchMode:room.mode,members:[...room.members.values()].map(c=>({id:c.id,name:c.name,hero:c.hero,ready:c.ready,connected:c.connected!==false}))};}
function broadcastRoster(room){notify(room,roster(room));}
function randomCode(){let code;do{code=crypto.randomBytes(4).toString('hex').slice(0,6).toUpperCase()}while(rooms.has(code));return code;}
function nameText(s){return typeof s==='string'?s.replace(/[<>\x00-\x1f]/g,'').trim().slice(0,18)||'Operative':'Operative'}
function chooseHero(room,wanted,self){const taken=new Set([...room.members.values()].filter(c=>c!==self).map(c=>c.hero));let w=Number.isInteger(wanted)?wanted:0;if(w>=0&&w<8&&!taken.has(w))return w;for(let i=0;i<8;i++)if(!taken.has(i))return i;return 0}
function leaveRoom(c){
  const room=c.room;if(!room)return;
  clearTimeout(c.reconnectTimer);c.reconnectTimer=null;
  room.members.delete(c.id);c.room=null;c.ready=false;
  if(room.hostId===c.id){rooms.delete(room.code);for(const other of room.members.values()){other.room=null;other.ready=false;send(other,{type:'closed',reason:'The host left. The match has ended.'});}room.members.clear();}
  else{notify(room,{type:'departed',id:c.id});broadcastRoster(room);if(!room.members.size)rooms.delete(room.code);}
}

function takeOverSlot(c,room,prior){
  if(c===prior){broadcastRoster(room);return;}
  if(c.room&&c.room!==room)leaveRoom(c);
  const tempId=c.id,oldSocket=prior.socket;
  clearTimeout(prior.reconnectTimer);prior.reconnectTimer=null;
  clients.delete(tempId);
  c.id=prior.id;c.name=prior.name;c.hero=prior.hero;c.ready=prior.ready;
  c.room=room;c.resumeToken=prior.resumeToken;c.connected=true;
  room.members.set(c.id,c);clients.set(c.id,c);
  prior.room=null;
  if(oldSocket&&!oldSocket.destroyed)oldSocket.destroy();
  send(c,{type:'resumed',id:c.id,hostId:room.hostId,room:room.code,started:room.started,matchMode:room.mode,difficulty:room.difficulty,members:roster(room).members});
  notify(room,{type:'peer_status',id:c.id,online:true});
  broadcastRoster(room);
  if(room.started){
    if(c.id===room.hostId)notify(room,{type:'host_resumed'});
    else send(room.members.get(room.hostId),{type:'resync_request',id:c.id});
  }
  console.log('[resume]',room.code,c.id,c.name,'started',room.started,'members',room.members.size);
}
function findByToken(room,token){return token&&room?[...room.members.values()].find(c=>c.resumeToken===token):null}
function validToken(msg){return typeof msg.token==='string'&&msg.token.length>=24&&msg.token.length<=128?msg.token:''}
function handle(c,msg){
  if (!msg || typeof msg!=='object'||typeof msg.type!=='string')return;
  if(msg.type==='ping'){send(c,{type:'pong',at:Date.now(),echo:Number(msg.t)||0});return;}
  if(msg.type==='resume'){
    const code=String(msg.room||'').trim().toUpperCase(),token=validToken(msg);
    const room=rooms.get(code),prior=findByToken(room,token);
    if(!prior){
      const reasonCode=room?'token_mismatch':'room_missing';
      console.warn('[resume-failed]',code||'-',reasonCode,'requester',c.id);
      send(c,{type:'resume_failed',reasonCode,reason:room?'That session could not be recovered. Use the invite link to join again if the match has not begun.':'That room no longer exists on this server. Ask the host for a fresh invite link.'});
      return;
    }
    takeOverSlot(c,room,prior);return;
  }
  if(msg.type==='create'){
    const token=validToken(msg);
    if(token){
      for(const existing of rooms.values()){
        const prior=findByToken(existing,token);
        if(prior){takeOverSlot(c,existing,prior);return;}
      }
    }
    if(c.room)leaveRoom(c);
    if(rooms.size>=150){send(c,{type:'error',message:'Server is at room capacity.'});return;}
    c.resumeToken=token||crypto.randomUUID();c.name=nameText(msg.name);c.hero=Number.isInteger(msg.hero)&&msg.hero>=0&&msg.hero<8?msg.hero:0;c.ready=true;
    const code=randomCode(),room={code,hostId:c.id,members:new Map([[c.id,c]]),started:false,mode:'campaign',difficulty:'normal',runSubmitted:false};rooms.set(code,room);c.room=room;
    console.log('[create]',code,'host',c.id,'origin',c.socket?.remoteAddress||'-');
    broadcastRoster(room);return;
  }
  if(msg.type==='join'){
    const code=String(msg.room||'').trim().toUpperCase(),room=rooms.get(code),token=validToken(msg);
    if(!room){console.warn('[join-failed]',code||'-','room-missing','requester',c.id);send(c,{type:'error',message:'Room not found on this server. Open the exact invite link from your host; rooms cannot cross between different Render website addresses.'});return;}
    const prior=findByToken(room,token);
    if(prior){takeOverSlot(c,room,prior);return;}
    if(room.started){send(c,{type:'error',message:'This match already started. Only disconnected players can reconnect.'});return;}
    if(room.members.size>=4){send(c,{type:'error',message:'That room already has four reserved player slots.'});return;}
    if(c.room)leaveRoom(c);
    c.resumeToken=token||crypto.randomUUID();c.name=nameText(msg.name);c.hero=chooseHero(room,msg.hero,c);c.ready=false;c.room=room;room.members.set(c.id,c);
    console.log('[join]',code,c.id,c.name,'members',room.members.size);
    broadcastRoster(room);return;
  }
  const room=c.room;
  if(!room)return;
  if(msg.type==='leave'){leaveRoom(c);send(c,{type:'left'});return;}
  if(msg.type==='settings'&&c.id===room.hostId&&!room.started){const d=['normal','hard','insanity'].includes(msg.difficulty)?msg.difficulty:'normal';room.difficulty=d;room.mode=msg.mode==='endless'?'endless':'campaign';broadcastRoster(room);return;}
  if(msg.type==='select'&&!room.started){const wanted=Number(msg.hero);if(!Number.isInteger(wanted)||wanted<0||wanted>7)return;c.hero=chooseHero(room,wanted,c);c.ready=c.id===room.hostId;broadcastRoster(room);return;}
  if(msg.type==='ready'&&!room.started){c.ready=!!msg.ready;broadcastRoster(room);return;}
  if(msg.type==='start'&&c.id===room.hostId&&!room.started){
    if([...room.members.values()].some(u=>!u.ready||!u.connected)){send(c,{type:'error',message:'All players must be connected and Ready before the host starts.'});return;}
    const d=['normal','hard','insanity'].includes(msg.difficulty)?msg.difficulty:'normal';if(d==='insanity'&&room.members.size<2){send(c,{type:'error',message:'INSANITY needs at least two connected players.'});return;}
    room.started=true;room.difficulty=d;room.mode=msg.mode==='endless'?'endless':'campaign';room.startedAt=Date.now();room.runSubmitted=false;notify(room,{type:'start',hostId:c.id,mode:room.mode,difficulty:room.difficulty,members:roster(room).members});return;
  }
  if(!room.started)return;
  if(msg.type==='restart'&&c.id===room.hostId){room.mode=msg.mode==='endless'?'endless':'campaign';room.difficulty=['normal','hard','insanity'].includes(msg.difficulty)?msg.difficulty:room.difficulty;room.runSubmitted=false;return;}
  if(msg.type==='run_end'&&c.id===room.hostId&&room.mode==='endless'&&!room.runSubmitted){
    const data=msg.data;if(!data||typeof data!=='object')return;
    if(!Number.isFinite(Number(data.wave))||!Number.isFinite(Number(data.score)))return;
    room.runSubmitted=true;
    const payload={...data,mode:'coop',players:[...room.members.values()].map(member=>member.name),name:c.name};
    saveScore(payload).then(result=>notify(room,{type:'score_saved',...result})).catch(()=>notify(room,{type:'score_saved',ok:false}));
    return;
  }
  if(msg.type==='input' && c.id!==room.hostId){
    const now=Date.now();if(now-c.lastInput<23)return;c.lastInput=now;
    const x=Number(msg.mx),y=Number(msg.my),a=Number(msg.aim);
    if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(a))return;
    send(room.members.get(room.hostId),{type:'input',id:c.id,mx:Math.max(-1,Math.min(1,x)),my:Math.max(-1,Math.min(1,y)),aim:a,fire:!!msg.fire,special:!!msg.special,dash:!!msg.dash,revive:!!msg.revive});return;
  }
  if(msg.type==='buy'&&c.id!==room.hostId){
    if(typeof msg.item!=='string'||msg.item.length>20)return;
    send(room.members.get(room.hostId),{type:'buy',id:c.id,item:msg.item});return;
  }
  if(msg.type==='state'&&c.id===room.hostId){
    if(!msg.data||typeof msg.data!=='object')return;
    const now=Date.now();if(now-c.lastState<55)return;c.lastState=now;
    const str=JSON.stringify({type:'state',data:msg.data});if(str.length>450000){if(!c.lastOversizeLog||now-c.lastOversizeLog>15000){console.warn('[state-dropped-too-large]',room.code,c.id,'chars',str.length);c.lastOversizeLog=now;}return;}
    for(const peer of room.members.values())if(peer!==c)relayRaw(peer,str);
  }
}
// V36: RFC6455 text continuation and control-frame support. The previous parser
// disconnected a client whenever a long message was fragmented across frames.
// Keep the room protocol dependency-free, but never interpret fragmentation as
// a broken connection. Every deliberate server closure is logged with a reason.
server.on('upgrade',(req,socket,head)=>{
  try{
    if(new URL(req.url,'http://localhost').pathname!=='/ws')throw Error('path');
    const key=req.headers['sec-websocket-key'];
    if(!req.headers.upgrade||req.headers.upgrade.toLowerCase()!=='websocket'||!key||typeof key!=='string'||Buffer.from(key,'base64').length!==16)throw Error('handshake');
    const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.setNoDelay(true);
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
    const c={id:'p'+(++nextId),socket,name:'Operative',hero:0,ready:false,connected:true,resumeToken:null,room:null,lastInput:0,lastState:0,lastPong:Date.now(),buffer:Buffer.alloc(0),fragments:[],fragmentBytes:0,fragmentOpcode:0,openedAt:Date.now(),frameCount:0};
    clients.set(c.id,c);send(c,{type:'hello',id:c.id});
    let endCause='peer or proxy closed TCP connection',closeCode=null,closing=false;
    function protocolClose(code,reason){
      if(closing)return;closing=true;
      endCause='protocol '+code+' '+reason;
      console.warn('[ws-protocol]',c.room?.code||'-',c.id,endCause,'buffered',socket.writableLength);
      const msg=Buffer.from(String(reason).slice(0,100)),data=Buffer.alloc(2+msg.length);
      data.writeUInt16BE(code,0);msg.copy(data,2);
      try{socket.end(encodeFrame(data,8));}catch{socket.destroy();}
      const t=setTimeout(()=>socket.destroy(),1500);t.unref?.();
    }
    function cleanup(){
      // An earlier connection may close AFTER its seat was resumed elsewhere.
      if(clients.get(c.id)!==c)return;
      const held=Date.now()-c.openedAt;
      console.log('[ws-close]',c.room?.code||'-',c.id,'ageMs',held,'code',closeCode??'-','reason',endCause,'frames',c.frameCount);
      clients.delete(c.id);
      const room=c.room;if(!room)return;
      // Preserve lobby members too: a one-second Wi-Fi hiccup must not destroy
      // the six-character invite code before the match begins.
      c.connected=false;c.socket=null;c.lastDisconnectedAt=Date.now();
      notify(room,{type:'peer_status',id:c.id,online:false,graceMs:RECONNECT_GRACE_MS});
      broadcastRoster(room);
      c.reconnectTimer=setTimeout(()=>{
        if(room.members.get(c.id)===c&&!c.connected){console.log('[expired]',room.code,c.id);leaveRoom(c);}
      },RECONNECT_GRACE_MS);
      c.reconnectTimer.unref?.();
      console.log('[disconnected, reserving seat]',room.code,c.id,'started',room.started);
    }
    socket.on('close',cleanup);
    socket.on('end',()=>{if(!closing)endCause=closeCode?'browser sent close frame':'peer or proxy sent TCP FIN';});
    socket.on('error',err=>{endCause='socket error '+(err?.code||err?.message||'unknown');console.warn('[ws-error]',c.room?.code||'-',c.id,endCause);});
    function deliverText(buf){
      try{const m=JSON.parse(buf.toString('utf8'));if(m&&typeof m.type==='string')handle(c,m)}
      catch(err){console.warn('[ws-message]',c.room?.code||'-',c.id,'invalid JSON:',String(err.message).slice(0,90));}
    }
    function consume(chunk){
      if(closing||socket.destroyed)return;
      c.buffer=c.buffer.length?Buffer.concat([c.buffer,chunk]):chunk;
      if(c.buffer.length>1_500_000){protocolClose(1009,'Buffered WebSocket message too large');return;}
      while(c.buffer.length>=2&&!closing){
        const a=c.buffer[0],b=c.buffer[1],opcode=a&15,fin=!!(a&128),masked=!!(b&128),rsv=a&0x70;
        let len=b&127,offset=2;
        if(len===126){if(c.buffer.length<4)return;len=c.buffer.readUInt16BE(2);offset=4;}
        else if(len===127){
          if(c.buffer.length<10)return;const big=c.buffer.readBigUInt64BE(2);
          if(big>BigInt(1_200_000)){protocolClose(1009,'Frame payload too large');return;}
          len=Number(big);offset=10;
        }
        if(!masked||rsv){protocolClose(1002,'Bad WebSocket masking or RSV bits');return;}
        if(len>1_200_000){protocolClose(1009,'Frame payload too large');return;}
        if(opcode>=8&&(!fin||len>125)){protocolClose(1002,'Invalid control frame');return;}
        if(c.buffer.length<offset+4+len)return;
        const mask=c.buffer.subarray(offset,offset+4),payload=Buffer.from(c.buffer.subarray(offset+4,offset+4+len));
        c.buffer=c.buffer.subarray(offset+4+len);c.frameCount++;
        for(let i=0;i<len;i++)payload[i]^=mask[i&3];
        if(opcode===8){
          closeCode=payload.length>=2?payload.readUInt16BE(0):1000;
          const text=payload.length>2?payload.subarray(2).toString('utf8').slice(0,100):'';
          endCause='browser close '+closeCode+' '+text;closing=true;
          try{socket.end(encodeFrame(payload,8));}catch{socket.destroy();}
          return;
        }
        if(opcode===9){try{socket.write(encodeFrame(payload,10));}catch(err){endCause='pong write failed';socket.destroy();}continue;}
        if(opcode===10){c.lastPong=Date.now();continue;}
        if(opcode!==0&&opcode!==1){protocolClose(1003,'Unsupported WebSocket message type');return;}
        if(opcode===1&&c.fragmentOpcode){protocolClose(1002,'New text message during fragmented message');return;}
        if(opcode===0&&!c.fragmentOpcode){protocolClose(1002,'Unexpected continuation frame');return;}
        if(opcode===1&&!fin){c.fragmentOpcode=1;c.fragments=[payload];c.fragmentBytes=payload.length;continue;}
        if(opcode===0){
          c.fragments.push(payload);c.fragmentBytes+=payload.length;
          if(c.fragmentBytes>1_100_000){protocolClose(1009,'Fragmented message too large');return;}
          if(fin){const full=Buffer.concat(c.fragments,c.fragmentBytes);c.fragments=[];c.fragmentBytes=0;c.fragmentOpcode=0;deliverText(full);}
          continue;
        }
        // Normal, unfragmented text frame.
        deliverText(payload);
      }
    }
    if(head.length)consume(head);
    socket.on('data',consume);
  }catch(err){console.warn('[ws-upgrade-rejected]',String(err.message).slice(0,90));socket.destroy();}
});
setInterval(()=>{
  for(const c of clients.values()){
    if(!c.socket||c.socket.destroyed)continue;
    if(Date.now()-c.lastPong>75000){console.warn('[ws-heartbeat-timeout]',c.room?.code||'-',c.id,'lastPongMs',Date.now()-c.lastPong);c.socket.destroy();continue;}
    if(c.socket.writableLength<300000)try{c.socket.write(encodeFrame('',9));}catch{}
  }
},22000).unref?.();
server.listen(PORT,'0.0.0.0',()=>console.log(`CROWN//CRISIS co-op ready on http://localhost:${PORT}`));
