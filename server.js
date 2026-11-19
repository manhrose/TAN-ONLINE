const express=require("express"),http=require("http"),{Server}=require("socket.io"),crypto=require("crypto");
const app=express(),server=http.createServer(app),io=new Server(server);
app.use(express.static("public"));
const rooms=new Map(),SUITS=["♠","♣","♦","♥"],RANKS=["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const id=()=>crypto.randomBytes(4).toString("hex").toUpperCase();
const shuffle=a=>{for(let i=a.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const get=(r,pid)=>r.players.find(p=>p.id===pid);
const rank=c=>RANKS.indexOf(c.rank);
function state(r,pid){
 const me=get(r,pid);
 return {code:r.code,phase:r.phase,host:r.host,players:r.players.map(p=>({id:p.id,name:p.name,count:p.hand.length,me:p.id===pid,defender:p.id===r.defender,attacker:p.id===r.attacker,passed:r.passed.has(p.id),finished:r.finishOrder.includes(p.id),place:r.finishOrder.indexOf(p.id)+1,connected:p.connected!==false})),
 hand:me?me.hand:[],trump:r.trump,trumpAvailable:r.trumpAvailable,deck:r.deck.length,table:r.table,attacker:r.attacker,defender:r.defender,finishOrder:r.finishOrder,
 took:r.took,round:r.round,message:r.message,winner:r.winner,canAttack:r.phase==="play"&&pid===r.attacker&&r.table.length===0,
 canDefend:r.phase==="play"&&pid===r.defender&&r.table.some(x=>!x.cover),
 canContribute:r.phase==="play"&&pid!==r.defender&&!r.finishOrder.includes(pid)&&r.table.length>0,
 canPass:r.phase==="play"&&pid!==r.defender&&!r.finishOrder.includes(pid)&&r.table.length>0&&(r.table.every(x=>x.cover)||r.took)};
}
function emit(r){for(const p of r.players)io.to(p.id).emit("state",state(r,p.id));}
function say(r,m){r.message=m;emit(r);}
function error(s,m){s.emit("errorMsg",m);}
function cardsOf(p,ids){
 if(!Array.isArray(ids)||ids.length<1||new Set(ids).size!==ids.length)return null;
 const a=ids.map(x=>p.hand.find(c=>c.id===x));return a.every(Boolean)?a:null;
}
function remove(p,ids){return ids.map(x=>p.hand.splice(p.hand.findIndex(c=>c.id===x),1)[0]);}
function validSet(a){return a&&a.length<=4&&a.every(c=>c.rank===a[0].rank);}
function tableRanks(r){return new Set(r.table.flatMap(t=>[t.card.rank,...(t.cover?[t.cover.rank]:[])]));}
function allCovered(r){return r.table.length>0&&r.table.every(t=>!!t.cover);}
function othersPassed(r){return r.players.filter(p=>p.id!==r.defender).every(p=>r.passed.has(p.id));}
function drawRound(r){
 // Rút theo thứ tự bắt đầu từ người đánh đầu vòng.
 for(let i=0;i<r.players.length;i++){
  const p=r.players[(r.roundStartIndex+i)%r.players.length];
  while(p.hand.length<8&&r.deck.length)p.hand.push(r.deck.pop());
  // Lá chưởng là lá cuối cùng được rút sau khi bộ bài úp đã hết.
  if(p.hand.length<8&&r.deck.length===0&&r.trumpAvailable){
   p.hand.push(r.trump);r.trumpAvailable=false;
  }
 }
}
function activePlayers(r){
 return r.players.filter(p=>!r.finishOrder.includes(p.id));
}
function recordFinishedPlayers(r){
 // Chỉ xếp hạng khi đã hết cả bài úp lẫn lá chưởng.
 if(r.deck.length!==0||r.trumpAvailable)return;
 for(const p of r.players){
  if(p.hand.length===0&&!r.finishOrder.includes(p.id)){
   r.finishOrder.push(p.id);
  }
 }
}
function finishRound(r){
 const defender=get(r,r.defender),failed=r.table.some(t=>!t.cover);
 if(failed&&defender){
  for(const t of r.table){defender.hand.push(t.card);if(t.cover)defender.hand.push(t.cover);}
  r.message=defender.name+" ôm toàn bộ bài trên bàn.";
 }else r.message="Đỡ hết thành công. Vòng đánh kết thúc.";
 const oldDef=r.defender,oldDefIndex=r.players.findIndex(p=>p.id===oldDef);
 r.table=[];r.passed.clear();r.took=false;
 drawRound(r);
 recordFinishedPlayers(r);
 const active=activePlayers(r);
 if(r.deck.length===0&&!r.trumpAvailable&&active.length<=1){
  r.phase="finished";
  const loser=active[0];
  r.winner=r.finishOrder.map(pid=>get(r,pid)?.name).filter(Boolean);
  r.message=loser
   ?"Ván kết thúc. "+r.winner.join(" → ")+" → "+loser.name+" (thua cuộc)."
   :"Ván kết thúc. Tất cả người chơi đã hết bài.";
  emit(r);return;
 }
 // Người đã về được xếp hạng và không tham gia các vòng sau.
 const preferredIndex=failed?(oldDefIndex+1)%r.players.length:r.players.findIndex(p=>p.id===defender?.id);
 let nextAttacker=null;
 for(let step=0;step<r.players.length;step++){
  const p=r.players[(preferredIndex+step+r.players.length)%r.players.length];
  if(!r.finishOrder.includes(p.id)){nextAttacker=p;break;}
 }
 if(!nextAttacker){r.phase="finished";emit(r);return;}
 const remaining=activePlayers(r);
 r.attacker=nextAttacker.id;
 const attackerIndex=r.players.findIndex(p=>p.id===r.attacker);
 let nextDefender=null;
 for(let step=1;step<=r.players.length;step++){
  const p=r.players[(attackerIndex+step)%r.players.length];
  if(!r.finishOrder.includes(p.id)){nextDefender=p;break;}
 }
 if(!nextDefender){
  r.phase="finished";r.message="Ván kết thúc.";emit(r);return;
 }
 r.defender=nextDefender.id;
 r.roundStartIndex=attackerIndex;
 r.round++;r.message+=" Lượt mới: "+nextAttacker.name+" đánh trước.";emit(r);
}
function maybeFinish(r){if((allCovered(r)||r.took)&&othersPassed(r))finishRound(r);else emit(r);}
function roomFor(s){return rooms.get(s.data.room);}
io.on("connection",s=>{
 s.on("createRoom",({name})=>{
  let code=id().slice(0,5),r={code,host:s.id,players:[{id:s.id,name:(name||"Người chơi").trim().slice(0,18)||"Người chơi",hand:[]}],phase:"lobby",deck:[],trump:null,trumpAvailable:true,finishOrder:[],table:[],attacker:null,defender:null,passed:new Set(),took:false,round:1,roundStartIndex:0,message:"Chờ người chơi tham gia.",winner:null};
  rooms.set(code,r);s.data.room=code;s.join(code);s.emit("joined",code);emit(r);
 });
 s.on("joinRoom",({name,code})=>{
  const r=rooms.get(String(code||"").toUpperCase());if(!r)return error(s,"Không tìm thấy phòng.");
  if(r.phase!=="lobby"||r.players.length>=4)return error(s,"Phòng đã bắt đầu hoặc đã đủ 4 người.");
  r.players.push({id:s.id,name:(name||"Người chơi").trim().slice(0,18)||"Người chơi",hand:[]});s.data.room=r.code;s.join(r.code);s.emit("joined",r.code);say(r,"Có người chơi tham gia.");
 });
 s.on("startGame",()=>{
  const r=roomFor(s);if(!r||s.id!==r.host)return;
  if(r.players.length<2)return error(s,"Cần ít nhất 2 người chơi.");
  const deck=shuffle(SUITS.flatMap(su=>RANKS.map(ra=>({id:id(),rank:ra,suit:su}))));
  // Lá chưởng phải có số nhỏ hơn 10 (2 đến 9).
  const eligible=deck.map((c,i)=>({c,i})).filter(x=>RANKS.indexOf(x.c.rank)>=0&&RANKS.indexOf(x.c.rank)<=7);
  const chosen=eligible[Math.floor(Math.random()*eligible.length)];
  r.trump=deck.splice(chosen.i,1)[0];r.trumpAvailable=true;r.finishOrder=[];r.deck=deck;
  r.players.forEach(p=>p.hand=r.deck.splice(0,8));
  r.phase="play";r.round=1;r.roundStartIndex=0;r.attacker=r.players[0].id;r.defender=r.players[1].id;
  r.table=[];r.passed.clear();r.took=false;r.message="Ván bắt đầu. "+r.players[0].name+" là người tấn đầu tiên.";emit(r);
 });
 s.on("attack",({ids})=>{
  const r=roomFor(s);if(!r||r.phase!=="play")return;
  if(s.id!==r.attacker||r.table.length!==0)return error(s,"Hiện tại không phải lượt tấn của bạn.");
  const p=get(r,s.id),a=cardsOf(p,ids);if(!validSet(a))return error(s,"Chọn từ 1 đến 4 lá cùng số.");
  const played=remove(p,ids);r.table=played.map(card=>({card,cover:null}));
  r.passed.clear();r.took=false;r.message=p.name+" tấn "+played.length+" lá "+played[0].rank+".";emit(r);
 });
 s.on("defend",({targetId,cardId})=>{
  const r=roomFor(s);if(!r||r.phase!=="play")return;
  if(s.id!==r.defender)return error(s,"Chỉ người bị tấn mới được đỡ.");
  const t=r.table.find(x=>x.card.id===targetId&&!x.cover),p=get(r,s.id),a=cardsOf(p,[cardId]);
  if(!t||!a)return error(s,"Chọn một lá đang bị tấn và một lá trên tay.");
  const c=a[0],v=t.card,isTrump=c.suit===r.trump.suit;
  const beats=(c.suit===v.suit&&rank(c)>rank(v))||(isTrump&&v.suit!==r.trump.suit);
  if(!beats)return error(s,"Lá đỡ phải lớn hơn cùng chất hoặc là lá chưởng.");
  remove(p,[cardId]);t.cover=c;r.took=false;r.message=p.name+" đã đỡ "+v.rank+v.suit+". Người khác có thể góp bài.";emit(r);
 });
 s.on("takeAll",()=>{
  const r=roomFor(s);if(!r||r.phase!=="play")return;
  if(s.id!==r.defender)return error(s,"Chỉ người bị tấn mới được ôm bài.");
  if(allCovered(r))return error(s,"Bạn đã đỡ hết bài đang có. Không cần ôm bài.");
  r.took=true;r.message=get(r,s.id).name+" chọn ôm bài; những người khác vẫn có thể góp thêm.";emit(r);
 });
 s.on("contribute",({ids})=>{
  const r=roomFor(s);if(!r||r.phase!=="play")return;
  if(s.id===r.defender)return error(s,"Người bị tấn không được góp bài cho chính mình.");
  if(r.finishOrder.includes(s.id))return error(s,"Bạn đã về và không còn tham gia vòng mới.");
  if(!r.table.length)return error(s,"Chưa có bài trên bàn để góp.");
  const p=get(r,s.id),a=cardsOf(p,ids),allowed=tableRanks(r);
  if(!a||a.length>4||!a.every(c=>allowed.has(c.rank)))return error(s,"Chỉ góp lá có số đang xuất hiện trên bàn.");
  const played=remove(p,ids);played.forEach(c=>r.table.push({card:c,cover:null}));
  // Lá mới mở lại quyền góp cho tất cả người khác; người đỡ phải xử lý các lá mới.
  r.passed.clear();r.took=false;r.message=p.name+" góp "+played.length+" lá. Người bị tấn cần xử lý lá mới.";emit(r);
 });
 s.on("pass",()=>{
  const r=roomFor(s);if(!r||r.phase!=="play")return;
  if(s.id===r.defender)return error(s,"Người bị tấn không bấm kết thúc lượt góp.");
  if(r.finishOrder.includes(s.id))return error(s,"Bạn đã về và không còn tham gia vòng mới.");
  if(!r.table.length)return error(s,"Chưa có lượt tấn để kết thúc.");
  if(!allCovered(r)&&!r.took)return error(s,"Người bị tấn chưa đỡ hết bài hoặc chọn ôm bài.");
  r.passed.add(s.id);r.message=get(r,s.id).name+" kết thúc lượt góp.";maybeFinish(r);
 });
 s.on("disconnect",()=>{
  const r=roomFor(s);if(!r)return;
  const p=get(r,s.id);if(p)p.connected=false;
  if(r.phase==="lobby"){r.players=r.players.filter(x=>x.id!==s.id);if(!r.players.length)rooms.delete(r.code);else emit(r);}
  else emit(r);
 });
});
server.listen(process.env.PORT||3000,()=>console.log("TAN ONLINE v2: http://localhost:3000"));
