const socket=io(),$=id=>document.getElementById(id);let S=null,selected=new Set(),target=null;
const rankOrder={"2":0,"3":1,"4":2,"5":3,"6":4,"7":5,"8":6,"9":7,"10":8,"J":9,"Q":10,"K":11,"A":12},suitOrder={"♠":0,"♣":1,"♦":2,"♥":3};
function toast(t){$("toast").textContent=t;$("toast").style.display="block";clearTimeout(toast.timer);toast.timer=setTimeout(()=>$("toast").style.display="none",2600)}
function esc(t){return String(t).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function makeCard(c,click=null,chosen=false){let e=document.createElement("div");e.className="card"+(["♦","♥"].includes(c.suit)?" red":"")+(chosen?" selected":"");e.innerHTML=`<span>${c.rank}</span><span class="suit">${c.suit}</span>`;if(click)e.onclick=click;return e}
function sortedHand(){let ts=S.trump.suit;return [...S.hand].sort((a,b)=>{let at=a.suit===ts?0:1,bt=b.suit===ts?0:1;if(at!==bt)return at-bt;if(rankOrder[a.rank]!==rankOrder[b.rank])return rankOrder[a.rank]-rankOrder[b.rank];return suitOrder[a.suit]-suitOrder[b.suit]})}
function button(parent,label,fn,primary=false){let b=document.createElement("button");b.textContent=label;if(primary)b.className="primary";b.onclick=fn;parent.appendChild(b)}
function render(){
 if(!S)return;$("lobby").hidden=S.phase!=="lobby";$("game").hidden=S.phase==="lobby";$("room").textContent="PHÒNG "+S.code;
 $("waiting").innerHTML=S.players.map(p=>`<span class="person">${esc(p.name)}${p.id===S.host?" ★":""}</span>`).join(" ");
 $("start").hidden=S.phase!=="lobby"||socket.id!==S.host;
 if(S.phase==="lobby")return;
 $("deck").innerHTML=`<span>${S.deck}</span>`;$("trump").innerHTML="";$("trump").appendChild(makeCard(S.trump));
 $("players").innerHTML=S.players.filter(p=>!p.me).map(p=>`<div class="person"><b>${esc(p.name)}</b><br>${p.count} lá${p.defender?" • ĐANG ĐỠ":""}${p.attacker?" • ĐANG TẤN":""}${p.passed?" • ĐÃ KẾT THÚC":""}</div>`).join("");
 $("status").textContent=S.message+(S.phase==="finished"?" • "+S.winner+" là người cuối cùng còn bài.":"");
 $("battle").innerHTML="";
 S.table.forEach(t=>{let pair=document.createElement("div");pair.className="pair";let c=makeCard(t.card,S.canDefend&&!t.cover?()=>{target=t.card.id;render()}:null,target===t.card.id);
 if(S.canDefend&&!t.cover){c.title="Bấm để chọn lá cần đỡ";c.setAttribute("aria-label","Chọn lá "+t.card.rank+t.card.suit+" để đỡ");}pair.appendChild(c);if(t.cover)pair.appendChild(makeCard(t.cover));$("battle").appendChild(pair)});
 $("hand").innerHTML="";sortedHand().forEach((c,i,arr)=>{let e=makeCard(c,()=>{selected.has(c.id)?selected.delete(c.id):selected.add(c.id);render()},selected.has(c.id));let prev=arr[i-1];if(i===0||(prev.suit!==S.trump.suit&&c.suit===S.trump.suit)||(prev.rank!==c.rank&&c.suit!==S.trump.suit))e.classList.add("group-start");$("hand").appendChild(e)});
 const box=$("actions");box.innerHTML="";const ids=[...selected];
 // Chỉ hiện nút hành động khi trạng thái server cho phép.
 if(S.canAttack&&ids.length)button(box,"TẤN",()=>{socket.emit("attack",{ids});selected.clear()},true);
 if(S.canDefend){if(target&&ids.length===1)button(box,"ĐỠ",()=>{socket.emit("defend",{targetId:target,cardId:ids[0]});selected.clear();target=null},true);button(box,"ÔM BÀI",()=>socket.emit("takeAll"));}
 if(S.canContribute&&ids.length)button(box,"GÓP BÀI",()=>{socket.emit("contribute",{ids});selected.clear()},true);
 if(S.canPass)button(box,"KẾT THÚC LƯỢT",()=>socket.emit("pass"));
}
$("create").onclick=()=>socket.emit("createRoom",{name:$("name").value});$("join").onclick=()=>socket.emit("joinRoom",{name:$("name").value,code:$("code").value.trim().toUpperCase()});$("start").onclick=()=>socket.emit("startGame");
socket.on("joined",c=>toast("Đã vào phòng "+c));socket.on("state",s=>{S=s;selected.clear();target=null;render()});socket.on("errorMsg",toast);
