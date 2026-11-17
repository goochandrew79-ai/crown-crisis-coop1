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
// V34: short outages must not eject a fighter from a long Endless run.
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
function handle(c,msg){
  if (!msg || typeof msg!=='object'||typeof msg.type!=='string')return;
  if(msg.type==='ping'){send(c,{type:'pong',at:Date.now(),echo:Number(msg.t)||0});return;}
  if(msg.type==='resume'){
    const code=String(msg.room||'').trim().toUpperCase();
    const token=typeof msg.token==='string'?msg.token:'';
    const room=rooms.get(code);
    const prior=room&&[...room.members.values()].find(member=>member.resumeToken&&member.resumeToken===token);
    if(!prior){send(c,{type:'resume_failed',reason:'Reconnection window expired, the room was lost, or this tab has a different session token.'});return;}
    const tempId=c.id,oldSocket=prior.socket;
    clearTimeout(prior.reconnectTimer);prior.reconnectTimer=null;
    clients.delete(tempId);
    c.id=prior.id;c.name=prior.name;c.hero=prior.hero;c.ready=prior.ready;
    c.room=room;c.resumeToken=prior.resumeToken;c.connected=true;
    room.members.set(c.id,c);clients.set(c.id,c);
    prior.room=null;
    // A broken network link can leave the old TCP session half-open. Allow the
    // holder of the same cryptographic session token to take over the slot.
    if(oldSocket&&!oldSocket.destroyed)oldSocket.destroy();
    send(c,{type:'resumed',id:c.id,hostId:room.hostId,room:room.code,started:room.started,matchMode:room.mode,difficulty:room.difficulty,members:roster(room).members});
    notify(room,{type:'peer_status',id:c.id,online:true});
    broadcastRoster(room);
    if(room.started){
      if(c.id===room.hostId)notify(room,{type:'host_resumed'});
      else send(room.members.get(room.hostId),{type:'resync_request',id:c.id});
    }
    console.log('[resume]',room.code,c.id,c.name,'members',room.members.size);
    return;
  }
  if(msg.type==='create'){
    if(c.room)leaveRoom(c);
    if(rooms.size>=150){send(c,{type:'error',message:'Server is at room capacity.'});return;}
    c.resumeToken=typeof msg.token==='string'&&msg.token.length>=24&&msg.token.length<=128?msg.token:crypto.randomUUID();c.name=nameText(msg.name);c.hero=Number.isInteger(msg.hero)&&msg.hero>=0&&msg.hero<8?msg.hero:0;c.ready=true;
    const code=randomCode(),room={code,hostId:c.id,members:new Map([[c.id,c]]),started:false,mode:'campaign',difficulty:'normal',runSubmitted:false};rooms.set(code,room);c.room=room;
    broadcastRoster(room);return;
  }
  if(msg.type==='join'){
    if(c.room)leaveRoom(c);
    const code=String(msg.room||'').trim().toUpperCase();const room=rooms.get(code);
    if(!room){send(c,{type:'error',message:'Room not found. Check the six-character code.'});return;}
    if(room.started){send(c,{type:'error',message:'That match has started. Join a new lobby.'});return;}
    if(room.members.size>=4){send(c,{type:'error',message:'That room already has four players.'});return;}
    c.resumeToken=typeof msg.token==='string'&&msg.token.length>=24&&msg.token.length<=128?msg.token:crypto.randomUUID();c.name=nameText(msg.name);c.hero=chooseHero(room,msg.hero,c);c.ready=false;c.room=room;room.members.set(c.id,c);broadcastRoster(room);return;
  }
  const room=c.room;
  if(!room)return;
  if(msg.type==='leave'){leaveRoom(c);send(c,{type:'left'});return;}
  if(msg.type==='settings'&&c.id===room.hostId&&!room.started){const d=['normal','hard','insanity'].includes(msg.difficulty)?msg.difficulty:'normal';room.difficulty=d;room.mode=msg.mode==='endless'?'endless':'campaign';broadcastRoster(room);return;}
  if(msg.type==='select'&&!room.started){const wanted=Number(msg.hero);if(!Number.isInteger(wanted)||wanted<0||wanted>7)return;c.hero=chooseHero(room,wanted,c);c.ready=c.id===room.hostId;broadcastRoster(room);return;}
  if(msg.type==='ready'&&!room.started){c.ready=!!msg.ready;broadcastRoster(room);return;}
  if(msg.type==='start'&&c.id===room.hostId&&!room.started){
    if([...room.members.values()].some(u=>!u.ready)){send(c,{type:'error',message:'Everyone must press READY before the host starts.'});return;}
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
    const str=JSON.stringify({type:'state',data:msg.data});if(str.length>450000)return;
    for(const peer of room.members.values())if(peer!==c)relayRaw(peer,str);
  }
}
server.on('upgrade',(req,socket,head)=>{
  try{
    if(new URL(req.url,'http://localhost').pathname!=='/ws')throw Error('path');
    const key=req.headers['sec-websocket-key'];
    if(!req.headers.upgrade||req.headers.upgrade.toLowerCase()!=='websocket'||!key||typeof key!=='string'||Buffer.from(key,'base64').length!==16)throw Error('handshake');
    const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
    const c={id:'p'+(++nextId),socket,name:'Operative',hero:0,ready:false,connected:true,resumeToken:null,room:null,lastInput:0,lastState:0,lastPong:Date.now(),buffer:Buffer.alloc(0)};
    clients.set(c.id,c);send(c,{type:'hello',id:c.id});
    const close=()=>{
      // Guard against late close events from an old socket after a successful resume.
      if(clients.get(c.id)!==c)return;
      clients.delete(c.id);
      const room=c.room;
      if(!room)return;
      if(!room.started){leaveRoom(c);return;}
      c.connected=false;c.socket=null;c.lastDisconnectedAt=Date.now();
      notify(room,{type:'peer_status',id:c.id,online:false,graceMs:RECONNECT_GRACE_MS});
      broadcastRoster(room);
      c.reconnectTimer=setTimeout(()=>{
        if(room.members.get(c.id)===c&&!c.connected){
          console.log('[expired]',room.code,c.id);
          leaveRoom(c);
        }
      },RECONNECT_GRACE_MS);
      c.reconnectTimer.unref?.();
      console.log('[disconnected, reserving seat]',room.code,c.id);
    };
    socket.on('close',close);socket.on('end',close);socket.on('error',close);
    function consume(chunk){
      c.buffer=Buffer.concat([c.buffer,chunk]);
      while(c.buffer.length>=2){
        const a=c.buffer[0],b=c.buffer[1],opcode=a&15,fin=(a&0x80)!==0,masked=(b&0x80)!==0;
        let len=b&127,offset=2;
        if(len===126){if(c.buffer.length<4)return;len=c.buffer.readUInt16BE(2);offset=4;}
        else if(len===127){if(c.buffer.length<10)return;const big=c.buffer.readBigUInt64BE(2);if(big>BigInt(1_100_000)){socket.destroy();return;}len=Number(big);offset=10;}
        if(!masked||!fin||len>1_100_000){socket.destroy();return;}
        if(c.buffer.length<offset+4+len)return;
        const mask=c.buffer.subarray(offset,offset+4),payload=Buffer.from(c.buffer.subarray(offset+4,offset+4+len));
        c.buffer=c.buffer.subarray(offset+4+len);
        for(let i=0;i<len;i++)payload[i]^=mask[i%4];
        if(opcode===8){socket.end(encodeFrame('',8));return;}
        if(opcode===9){socket.write(encodeFrame(payload,10));continue;}
        if(opcode===10){c.lastPong=Date.now();continue;}
        if(opcode!==1)continue;
        try{handle(c,JSON.parse(payload.toString('utf8')));}catch{}
      }
    }
    if(head.length)consume(head);
    socket.on('data',consume);
  }catch{socket.destroy();}
});
setInterval(()=>{
  for(const c of clients.values()){
    if(!c.socket||c.socket.destroyed)continue;
    if(Date.now()-c.lastPong>75000){c.socket.destroy();continue;}
    if(c.socket.writableLength<300000)try{c.socket.write(encodeFrame('',9));}catch{}
  }
},22000).unref?.();
server.listen(PORT,'0.0.0.0',()=>console.log(`CROWN//CRISIS co-op ready on http://localhost:${PORT}`));
