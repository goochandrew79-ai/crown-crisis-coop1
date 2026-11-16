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

const server = http.createServer((req, res) => {
  let pathname = '/';
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { res.writeHead(400).end(); return; }
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
  if (!client || client.socket.destroyed) return;
  try {
    const str=JSON.stringify(obj);
    if (client.socket.writableLength > 1000000) return; // drop a slow spectator frame
    client.socket.write(encodeFrame(str));
  } catch {}
}
function relayRaw(client, str){
  if(!client||client.socket.destroyed||client.socket.writableLength>1000000)return;
  try {client.socket.write(encodeFrame(str));}catch{}
}
function notify(room, obj, except) {for(const c of room.members.values())if(c!==except)send(c,obj);}
function roster(room){return {type:'roster',room:room.code,hostId:room.hostId,started:room.started,members:[...room.members.values()].map(c=>({id:c.id,name:c.name,hero:c.hero,ready:c.ready}))};}
function broadcastRoster(room){notify(room,roster(room));}
function randomCode(){let code;do{code=crypto.randomBytes(4).toString('hex').slice(0,6).toUpperCase()}while(rooms.has(code));return code;}
function nameText(s){return typeof s==='string'?s.replace(/[<>\x00-\x1f]/g,'').trim().slice(0,18)||'Operative':'Operative'}
function chooseHero(room,wanted,self){const taken=new Set([...room.members.values()].filter(c=>c!==self).map(c=>c.hero));let w=Number.isInteger(wanted)?wanted:0;if(w>=0&&w<8&&!taken.has(w))return w;for(let i=0;i<8;i++)if(!taken.has(i))return i;return 0}
function leaveRoom(c){
  const room=c.room;if(!room)return;
  room.members.delete(c.id);c.room=null;c.ready=false;
  if(room.hostId===c.id){rooms.delete(room.code);for(const other of room.members.values()){other.room=null;other.ready=false;send(other,{type:'closed',reason:'The host left. The match has ended.'});}room.members.clear();}
  else{notify(room,{type:'departed',id:c.id});broadcastRoster(room);if(!room.members.size)rooms.delete(room.code);}
}
function handle(c,msg){
  if (!msg || typeof msg!=='object'||typeof msg.type!=='string')return;
  if(msg.type==='create'){
    if(c.room)leaveRoom(c);
    if(rooms.size>=150){send(c,{type:'error',message:'Server is at room capacity.'});return;}
    c.name=nameText(msg.name);c.hero=Number.isInteger(msg.hero)&&msg.hero>=0&&msg.hero<8?msg.hero:0;c.ready=true;
    const code=randomCode(),room={code,hostId:c.id,members:new Map([[c.id,c]]),started:false};rooms.set(code,room);c.room=room;
    broadcastRoster(room);return;
  }
  if(msg.type==='join'){
    if(c.room)leaveRoom(c);
    const code=String(msg.room||'').trim().toUpperCase();const room=rooms.get(code);
    if(!room){send(c,{type:'error',message:'Room not found. Check the six-character code.'});return;}
    if(room.started){send(c,{type:'error',message:'That match has started. Join a new lobby.'});return;}
    if(room.members.size>=4){send(c,{type:'error',message:'That room already has four players.'});return;}
    c.name=nameText(msg.name);c.hero=chooseHero(room,msg.hero,c);c.ready=false;c.room=room;room.members.set(c.id,c);broadcastRoster(room);return;
  }
  const room=c.room;
  if(!room)return;
  if(msg.type==='leave'){leaveRoom(c);send(c,{type:'left'});return;}
  if(msg.type==='select'&&!room.started){const wanted=Number(msg.hero);if(!Number.isInteger(wanted)||wanted<0||wanted>7)return;c.hero=chooseHero(room,wanted,c);c.ready=c.id===room.hostId;broadcastRoster(room);return;}
  if(msg.type==='ready'&&!room.started){c.ready=!!msg.ready;broadcastRoster(room);return;}
  if(msg.type==='start'&&c.id===room.hostId&&!room.started){
    if([...room.members.values()].some(u=>!u.ready)){send(c,{type:'error',message:'Everyone must press READY before the host starts.'});return;}
    room.started=true;notify(room,{type:'start',hostId:c.id,members:roster(room).members});return;
  }
  if(!room.started)return;
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
    const str=JSON.stringify({type:'state',data:msg.data});if(str.length>700000)return;
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
    const c={id:'p'+(++nextId),socket,name:'Operative',hero:0,ready:false,room:null,lastInput:0,lastState:0,buffer:Buffer.alloc(0)};
    clients.set(c.id,c);send(c,{type:'hello',id:c.id});
    const close=()=>{if(!clients.has(c.id))return;clients.delete(c.id);leaveRoom(c);};
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
        if(opcode!==1)continue;
        try{handle(c,JSON.parse(payload.toString('utf8')));}catch{}
      }
    }
    if(head.length)consume(head);
    socket.on('data',consume);
  }catch{socket.destroy();}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`CROWN//CRISIS co-op ready on http://localhost:${PORT}`));
