(()=>{
'use strict';

/* ===== ルール定義 ===== */
const VALS=[1,2,3,4,5,6,7,8,9,10,13,'J'];
const ORD=v=>VALS.indexOf(v);
const pts=v=>v==='J'?16:v;
const lab=v=>v==='J'?'J':String(v);
const pv=s=>s==='J'?'J':Number(s);
// 攻撃カードaが守備カードdに勝つか（同じ数字は守備の勝ち）
function beats(a,d){
  if(a===d) return false;
  if(a==='J') return d!==1;
  if(a===1) return d==='J';
  if(d==='J') return false;
  return a>d;
}
const rnd=n=>Math.floor(Math.random()*n);
const fresh=()=>[[],[],[],[],[]];
// ---- CPUの守備の置き方（作戦） ----
// 試合ごとに作戦をランダムに選ぶ（弱い・普通・強いで共通）。どれも「左が弱く右が強い、ジョーカーだけ好きな位置」のルールは守る。
//  offense  攻撃重視：守備は弱め〜中くらいの札。13や10・9は攻撃に使う
//  fortress 守備固め：強い札で守りを固める。手札は弱い札とジョーカー・1
//  balance  バランス：弱い・中・強いをまんべんなく守備に置く
//  jrec     ジョーカー回収型：ジョーカーを守備に隠し、スキルで手札に回収する
//  trap     1回収型：1を守備に隠す（ジョーカーで攻められたら1で返り討ち）。相手のジョーカーが残ってる間に、スキルで回収する
//  both     ジョーカーと1の両方を守備に隠す
//  bluff    （上の3つ offense/fortress/balance に重ねる）ジョーカー・1は守備に入れないまま、回収したように見せかけるスキルを使う
const sample=(arr,k)=>{const a=arr.slice();for(let i=a.length-1;i>0;i--){const j=rnd(i+1);[a[i],a[j]]=[a[j],a[i]];}return a.slice(0,k);};
const layoutDef=vals=>{
  const nums=vals.filter(v=>v!=='J').sort((a,b)=>a-b);
  if(vals.includes('J')) nums.splice(rnd(nums.length+1),0,'J');
  return nums;
};
const PLAN_KINDS=[['offense',17],['fortress',17],['balance',22],['jrec',16],['trap',10],['both',6]];
function pickDefensePlan(){
  let r=rnd(PLAN_KINDS.reduce((a,x)=>a+x[1],0)),kind='balance';
  for(const [k,w] of PLAN_KINDS){if(r<w){kind=k;break;}r-=w;}
  let vals,rec=false,bluff=false;
  if(kind==='offense') vals=sample([2,3,4,5,6,7,8],5);
  else if(kind==='fortress'){do{vals=sample([6,7,8,9,10,13],5);}while(vals.filter(v=>v>=9).length<3);}
  else if(kind==='balance'){
    const a=sample([2,3,4],1),b=sample([5,6,7],1),c=sample([8,9,10],1);
    const rest=sample([2,3,4,5,6,7,8,9,10,13].filter(v=>![...a,...b,...c].includes(v)),2);
    vals=[...a,...b,...c,...rest];
  }
  else if(kind==='jrec'){vals=['J',...sample([3,4,5,6,7,8,9,10],4)];rec=true;}
  else if(kind==='trap'){vals=[1,...sample([3,4,5,6,7,8,9,10,13],4)];rec=true;}
  else{vals=['J',1,...sample([4,5,6,7,8,9,10],3)];rec=true;}
  if(!rec&&Math.random()<0.3) bluff=true;
  return {kind,def:layoutDef(vals),rec,bluff,recAt:0.15+Math.random()*0.45,bluffAt:0.15+Math.random()*0.4};
}
// 並びのルール：最初の配置は、ジョーカー以外が左から右へ強くなる（ジョーカーはどこでも可）
function orderOK(vals){
  let prev=0;
  for(const v of vals){ if(v==='J') continue; if(v<=prev) return false; prev=v; }
  return true;
}
function arrange(sel,jpos){
  const nums=sel.filter(v=>v!=='J').sort((a,b)=>a-b);
  if(sel.includes('J')) nums.splice(Math.min(jpos,nums.length),0,'J');
  return nums;
}
// スキル後は並びが崩れてもいい。相手がスキルを使った後は「1枚だけ崩れている」ところまで矛盾なしとみなす
function relaxedOK(vals){
  return vals.some((_,j)=>orderOK(vals.filter((__,k)=>k!==j)));
}

/* ===== 状態 ===== */
// CPUの強さ（3段階）
// margin:勝った時の「余り」（強すぎる札を使うこと）をどれだけ嫌うか／futK:あとで「ちょうどこの札が必要になる」守備札があるなら、今は使いたくない気持ち／costK:札の大きさそのものの惜しさ／resJ,res1:ジョーカーと1を「まだ温存しておく価値」（大きいほど解禁が遅い）／noise:攻撃選びのブレ／sloppy:何も考えず選ぶ確率／order:相手の並びのルールから推理するか／rec:札の回収スキル／def:守りのスキル／aucStart,aucResp:オークションの積極さ／smart:相手のスキル・オークションの動きも推理に使い、手札も読んで攻撃を選ぶ
const LEVELS={
  1:{name:'弱い',noise:6,sloppy:0.35,order:false,rec:0.25,def:0.35,aucStart:0,aucResp:0.25,resJ:3,res1:1.5,margin:0.3,costK:0.45,futK:0},
  2:{name:'普通',noise:5,sloppy:0.3,order:true,rec:0.4,def:0.5,aucStart:0.6,aucResp:0.6,resJ:6,res1:3,margin:0.6,costK:0.45,futK:0.2},
  3:{name:'強い',noise:1.2,sloppy:0,order:true,rec:0.7,def:0.9,aucStart:1,aucResp:1,smart:true,resJ:6,res1:3,margin:0.9,costK:0.45,futK:0.3}
};
let LEVEL=2;
const lv=()=>LEVELS[LEVEL];
function side(){return {hand:[],def:[],skill:false,used:[],swBack:null};}
function newGame(phase){
  return {phase:phase||'setup',sel:[],jpos:4,p:side(),c:side(),turn:null,first:null,
    notes:fresh(),cfails:fresh(),pSkill:null,psig:[],caution:1,patience:0,plan:null,msg:'',showRules:false,
    selCard:null,selSlot:null,swHand:null,swDef:null,decl:null,auc:null,aucSel:null,result:null,final:null,revealAll:false,anim:null};
}
let S=newGame('title');
const app=document.getElementById('app');

const canSkill=s=>!s.skill&&s.hand.length>0&&s.def.some(d=>!d.open);
const sumOpen=s=>s.def.filter(d=>d.open).reduce((a,d)=>a+pts(d.v),0);
const cntOpen=s=>s.def.filter(d=>d.open).length;
const cardVal=h=>h==='J'?13:(h===1?2:h);
// 1かジョーカーで攻撃された時は、オークションを使えない
const aucAllowed=card=>card!==1&&card!=='J';
const canAuction=(s,card)=>aucAllowed(card)&&s.hand.some(h=>beats(h,card));
// オークション：直前の札より強い（beats）札だけ出せる。攻撃側は最初の攻撃札そのものは出せない
const bidOK=(v,who)=>!!S.auc&&beats(v,S.auc.top.card)&&!(S.auc.att===who&&v===S.auc.card);
const bidOpts=who=>(who==='p'?S.p:S.c).hand.filter(v=>bidOK(v,who));
function doSwap(s,handV,slot){
  const h=s.hand.indexOf(handV);
  const old=s.def[slot].v;
  s.def[slot].v=handV;
  s.def[slot].sw=true;   // 守備に入れた札（目印用）
  s.hand[h]=old;
  s.swBack=old;          // 手札に戻した札（目印用）
  s.skill=true;
}

/* ===== 描画 ===== */
// kind: 'a'=攻撃札（金・角形） 'd'=守備札（灰青・盾形）
function face(v,kind='a',extra='',tag=false){
  const j=v==='J';
  return `<div class="card face ${kind} ${j?'j':''} ${extra}"><span class="n">${j?'J':v}</span>${tag?`<span class="tg ${kind}">替</span>`:''}</div>`;
}
function backCard(extra=''){return `<div class="card back d ${extra}"></div>`;}

// ロゴ：カードの裏のモノグラム（H・T・Jを組み合わせた形）
function logoSvg(){
  return `<svg class="logo" viewBox="40 34 450 536" role="img" aria-label="HTJ">
    <g fill="currentColor">
      <path d="M60 50H472L462 98H88Z"/>
      <path d="M88 98H128V418Q128 434 144 448H60Q80 436 80 418Z"/>
      <rect x="128" y="235" width="94" height="30"/>
      <rect x="184" y="155" width="38" height="245"/>
      <rect x="320" y="155" width="122" height="40"/>
    </g>
    <g fill="none" stroke="currentColor" stroke-width="44">
      <path d="M272 96V482Q272 528 224 528Q180 528 150 498"/>
      <path d="M442 96V404Q442 445 402 445H380Q340 445 340 405V292"/>
    </g>
  </svg>`;
}
function titleView(){
  const firstShow=!S.titleSeen; // 初回表示の時だけロゴをフェードインさせ、CPUの強さ切り替えでは動かさない
  S.titleSeen=true;
  const segs=[1,2,3].map(n=>`<button class="seg ${LEVEL===n?'on':''}" data-act="level" data-n="${n}" aria-pressed="${LEVEL===n}">${LEVELS[n].name}</button>`).join('');
  return `<div class="title">
    <div class="cardlogo ${firstShow?'in':''}">${logoSvg()}</div>
    <div class="brand"><div class="bn">HYDE THE JOKER</div></div>
    <div class="lvl"><div class="cap">CPUの強さ</div><div class="segs">${segs}</div></div>
    <button class="btn pri big" data-act="play">プレイ</button>
    <button class="ghost" data-act="rules">ルール</button>
    <div class="ver">ver.1.0</div>
  </div>`;
}

function header(){
  const chip=S.turn&&S.phase!=='over'?`<span class="chip ${S.turn}">${S.turn==='p'?'あなたの攻撃':'CPUの攻撃'}</span>`:'';
  return `<header><h1>${logoSvg()}HYDE THE JOKER</h1><div class="hr">${chip}<button class="ghost" data-act="rules">ルール</button></div></header>`;
}

function setupView(){
  const cards=VALS.map(v=>{
    const k=S.sel.indexOf(v);
    return `<div><button class="slot" data-act="pick" data-v="${v}" aria-pressed="${k>=0}" aria-label="${lab(v)}">${face(v,k>=0?'d':'a',k>=0?'sel':'')}</button></div>`;
  }).join('');
  const arr=arrange(S.sel,S.jpos);
  const hasJ=S.sel.includes('J');
  const jIdx=arr.indexOf('J');
  const slots=[0,1,2,3,4].map(i=>arr[i]!==undefined?`<div>${face(arr[i],'d')}</div>`:'<div class="pslot"></div>').join('');
  const canMove=hasJ&&S.sel.length>1;
  const mv=`<div class="mv"><button class="ghost" data-act="jleft" ${(!canMove||jIdx<=0)?'disabled':''}>ジョーカーを左へ</button><button class="ghost" data-act="jright" ${(!canMove||jIdx>=arr.length-1)?'disabled':''}>ジョーカーを右へ</button></div>`;
  return `${header()}
  <div class="setup">
    <p>守備に伏せる5枚を選ぶ。並びは自動で左が弱く右が強い順になる。<b class="hl">ジョーカーは位置を選べる。</b>選ばなかった札は攻撃札となる。</p>
    <div class="grid">${cards}</div>
    <div class="cap" style="text-align:center">守備札　${S.sel.length} / 5</div>
    <div class="row prev">${slots}</div>
    ${mv}
    <button class="btn pri" data-act="confirm-def" ${S.sel.length===5?'':'disabled'}>決定</button>
  </div>`;
}

function tracker(s){
  return `<div class="trk">${VALS.map(v=>{
    const u=s.used.includes(v),o=s.def.some(d=>d.open&&d.v===v);
    return `<i class="${u?'u':o?'o':''} ${v==='J'?'jk':''}">${lab(v)}</i>`;
  }).join('')}</div>`;
}

function cpuRow(){
  const selMode=S.phase==='p_attack';
  // CPUの並びは向かい側から見て左が弱い。あなたから見ると左右が逆になるので、逆順で描画する
  return [4,3,2,1,0].map(i=>{
    const d=S.c.def[i];
    const show=d.open||S.revealAll;
    const cls=[d.open?'opened':'',S.anim&&S.anim.side==='c'&&S.anim.slot===i?'flip':'',selMode&&!d.open&&S.selSlot===i?'sel':''].join(' ');
    const inner=show?face(d.v,'d',cls):backCard(cls);
    const ok=selMode&&!d.open;
    const notes=S.notes[i].map(v=>'×'+lab(v)).join(' ');
    return `<div class="slotwrap"><button class="slot" ${ok?`data-act="cslot" data-i="${i}"`:'disabled'} aria-label="CPUの守備 ${5-i}">${inner}</button><div class="note"><b>${5-i}</b>${notes}</div></div>`;
  }).join('');
}

function incoming(){
  // CPUの攻撃を受けている間、その攻撃札と狙われている守備札
  const inPhase=['p_defend_prompt','p_skill_def','c_declared'].includes(S.phase)&&S.decl;
  if(inPhase) return {card:S.decl.card,slot:S.decl.slot};
  if((S.phase==='auc_me'||S.phase==='auc_cpu')&&S.auc&&S.auc.att==='c') return {card:S.auc.card,slot:S.auc.slot};
  if(S.phase==='resolving'&&S.result&&S.result.att==='c') return {card:S.result.card,slot:S.result.slot};
  return null;
}
function outgoing(){
  if(S.phase==='p_attack'&&S.selCard!=null&&S.selSlot!=null) return {card:S.selCard,slot:S.selSlot};
  if((S.phase==='auc_me'||S.phase==='auc_cpu')&&S.auc&&S.auc.att==='p') return {card:S.auc.card,slot:S.auc.slot};
  if(S.phase==='resolving'&&S.result&&S.result.att==='p') return {card:S.result.card,slot:S.result.slot};
  return null;
}

function pRow(){
  const skillMode=S.phase==='p_skill_atk'||S.phase==='p_skill_def';
  const inc=incoming();
  return S.p.def.map((d,i)=>{
    const aimed=inc&&inc.slot===i;
    const cls=[d.open?'opened':'',S.anim&&S.anim.side==='p'&&S.anim.slot===i?'flip':'',skillMode&&S.swDef===i?'sel':'',aimed?'aimed':''].join(' ');
    const ok=skillMode&&!d.open;
    return `<div class="slotwrap"><button class="slot" ${ok?`data-act="pslot" data-i="${i}"`:'disabled'} aria-label="あなたの守備 ${i+1}${d.sw?'（スキルで入れ替えた札）':''}">${face(d.v,'d',cls,!!d.sw)}</button><div class="note"><b>${i+1}</b></div></div>`;
  }).join('');
}

function topLane(){
  const o=outgoing();
  return [4,3,2,1,0].map(i=>`<div class="lc">${o&&o.slot===i?`<i class="ar up"></i>${face(o.card,'a')}`:''}</div>`).join('');
}
function botLane(){
  const n=incoming();
  return [0,1,2,3,4].map(i=>`<div class="lc">${n&&n.slot===i?`${face(n.card,'a','cpu')}<i class="ar dn"></i>`:''}</div>`).join('');
}

function handRow(){
  const a=S.phase==='p_attack',sk=S.phase==='p_skill_atk'||S.phase==='p_skill_def',au=S.phase==='auc_me';
  if(!S.p.hand.length) return '<span class="none">攻撃札なし</span>';
  return S.p.hand.slice().sort((x,y)=>ORD(x)-ORD(y)).map(v=>{
    const sel=a?S.selCard===v:sk?S.swHand===v:au?S.aucSel===v:false;
    const valid=au?bidOK(v,'p'):true;
    const ok=a||sk||(au&&valid);
    const cls=[sel?'sel':'',au&&!valid?'dim':''].join(' ');
    return `<button class="slot" ${ok?`data-act="hand" data-v="${v}"`:'disabled'} aria-label="攻撃札 ${lab(v)}${v===S.p.swBack?'（スキルで手札に戻した札）':''}">${face(v,'a',cls,v===S.p.swBack)}</button>`;
  }).join('');
}

// オークションの流れ（攻撃札→入札…）を小さなカードで並べる。金＝あなた、紫＝CPU、白枠＝現在いちばん強い札
function chainRow(chain){
  return `<div class="bids">${chain.map((b,i)=>`${i?'<span class="sep">›</span>':''}${face(b.card,'a',(b.by==='c'?'cpu ':'')+(i===chain.length-1?'top':''))}`).join('')}</div>`;
}
function aucChain(){return [{card:S.auc.card,by:S.auc.att}].concat(S.auc.bids);}

function incomingLine(){
  const d=S.decl,dv=S.p.def[d.slot].v,defWin=!beats(d.card,dv);
  return `<div class="inl"><b>${lab(d.card)}</b>で<b>${d.slot+1}</b>に攻撃<span class="${defWin?'w':'l'}">（${defWin?'勝ち':'負け'}）</span></div>`;
}

function mid(){
  const ph=S.phase;
  const btn=(act,txt,cls='',dis=false)=>`<button class="btn ${cls}" data-act="${act}" ${dis?'disabled':''}>${txt}</button>`;
  if(ph==='start') return `<div class="msg">先攻：${S.first==='p'?'あなた':'CPU'}</div><div class="acts">${btn('begin','はじめる','pri')}</div>`;
  if(ph==='p_attack'){
    const ok=S.selCard!=null&&S.selSlot!=null;
    return `${S.msg?`<div class="msg s">${S.msg}</div>`:''}<div class="acts">${btn('skill',S.p.skill?'スキル使用済み':'スキル','',!canSkill(S.p))}${btn('attack','攻撃する','pri',!ok)}</div>`;
  }
  if(ph==='p_skill_atk'||ph==='p_skill_def'){
    const ok=S.swHand!=null&&S.swDef!=null;
    return `${ph==='p_skill_def'?incomingLine():''}<div class="msg s">入れ替える2枚を選んで</div><div class="acts">${btn('skill-cancel','やめる')}${btn('do-swap','入れ替える','pri',!ok)}</div>`;
  }
  if(ph==='p_defend_prompt'){
    const canAuc=canAuction(S.p,S.decl.card);
    return `${incomingLine()}<div class="acts">${btn('skill-def','スキル使用','sm',!canSkill(S.p))}${btn('auction','オークション','sm',!canAuc)}${btn('accept','受け入れる','pri sm')}</div>`;
  }
  if(ph==='auc_me'){
    const ok=S.aucSel!=null,first=S.auc.bids.length===0;
    return `${chainRow(aucChain())}<div class="acts">${btn('auc-pass',first?'やめる':'降りる')}${btn('bid',first?'入札する':'上書きする','pri',!ok)}</div>`;
  }
  if(ph==='auc_cpu') return `${chainRow(aucChain())}<div class="msg s">CPU考え中</div>`;
  if(ph==='c_declared') return incomingLine();
  if(ph==='c_thinking') return `<div class="msg s">${S.msg||'CPU考え中'}</div>`;
  if(ph==='resolving'){
    const r=S.result,me=r.att==='p';
    const title=me?(r.win?'攻撃成功':'失敗'):(r.win?'突破された':'守りきった');
    let good=me?r.win:!r.win,t=title;
    if(r.chain){good=(r.att==='p')===r.win;t=good?'オークション勝ち':'オークション負け';}
    return `${r.chain?chainRow(r.chain):''}<div class="msg ${good?'win':'lose'}">${t}</div><div class="acts">${btn('next','つづける','pri')}</div>`;
  }
  if(ph==='over') return `<div class="msg ${S.final.res}">${S.msg}</div><div class="sub">${S.final.detail}</div><div class="acts">${btn('restart','もう一度','pri')}${btn('title','タイトルへ')}</div>`;
  return '';
}

function gameView(){
  const c=S.c,p=S.p;
  // 攻撃札のレーンは、攻撃する側・受ける側のどちらかの時だけ出す（選択中にボタン位置が動かないよう、内容ではなくフェーズで決める）
  const showTop=S.phase==='p_attack'||!!outgoing();
  const showBot=!!incoming();
  return `${header()}
  <section class="zone">
    <div class="zinfo"><span class="dot cpu"></span><b>CPU</b><span>攻撃札 ${c.hand.length}枚</span><span>スキル ${c.skill?'済':'未'}</span><span class="pt">失点 ${sumOpen(c)}</span></div>
    ${tracker(c)}
    <div class="dwrap"><span class="end l">強</span><div class="row dfn">${cpuRow()}</div><span class="end r">弱</span></div>
  </section>
  <section class="arena">
    ${showTop?`<div class="row dfn lane">${topLane()}</div>`:''}
    <div class="mid">${mid()}</div>
    ${showBot?`<div class="row dfn lane">${botLane()}</div>`:''}
  </section>
  <section class="zone">
    <div class="row dfn">${pRow()}</div>
    <div class="hand">${handRow()}</div>
    <div class="zinfo"><span class="dot me"></span><b>あなた</b><span>スキル ${p.skill?'済':'未'}</span><span class="pt">失点 ${sumOpen(p)}</span></div>
    ${tracker(p)}
  </section>`;
}

function rulesView(){
  return `<div class="modal"><div class="panel">
  <h2>ルール</h2>
  <ul>
    <li>手札は 1〜10・13・ジョーカーの12枚。5枚を守備札（灰青の盾形）に伏せ、残り7枚が攻撃札（金色）。</li>
    <li>数字が大きい方が勝ち。ジョーカーは1以外に勝ち、1はジョーカーだけに勝つ。同じ数字は守備の勝ち。</li>
    <li>守備札は最初に、自分から見て左が弱く右が強くなるよう並べる（ジョーカーだけ好きな位置）。CPUは向かい側から並べるので、あなたから見ると右が弱く左が強い。</li>
    <li>攻撃札の数字は宣言と同時に相手に見える。守備側は勝ち負けだけ答える。攻撃札は勝敗に関係なく使い切り。攻撃が勝てば守備札が捲られてもう一度攻撃、負ければ攻守交代。攻撃札が尽きた側は攻撃できず、残った側が続ける。</li>
    <li>スキルは1ゲーム1回。攻撃札1枚と伏せてる守備札1枚をその場所で入れ替える（入れ替えた札には「替」の印が付く）。並びは崩れてもよく、並び直しもしない。攻撃前でも、宣言された後（数字と勝ち負けを見てから）でも使える。宣言後に使うと攻撃は中断され、攻撃側は攻撃札も攻撃先も選び直せる。</li>
    <li>オークション：守備側は、攻撃札の数字を見てから（1かジョーカーで攻撃された時は使えない）、その攻撃札より強い攻撃札を1枚捨てて「そのターンに勝った」ことにできる。攻撃側も、それより強い攻撃札を1枚捨てて上書きでき、お互い1枚ずつ、手札がある限り何度でも上書きできる。降りた側の負けで、最後に勝った側は通常の勝ちと同じ結果になる（攻撃側なら守備札が捲られて攻撃続行、守備側なら守備札は伏せたまま攻守交代）。捨てた札は使用済みになり、数字も見える。強さは通常と同じ判定で、同じ数字では上書きできない。オークション中はスキルを使えない。</li>
    <li>守備札が全部捲られたら負け。攻撃札が両方尽きたら、失点（捲られた守備札の点数の合計）が少ない方の勝ち（ジョーカーは16点）。同点なら捲られた枚数が少ない方、それも同じなら引き分け。</li>
    <li>上下の数字の一覧は、暗い数字が使用済みの攻撃札、赤い数字が捲られた守備札。CPUの守備札の下の「×7」は、その守備札に負けた自分の攻撃札で、CPUがスキルを使うとリセットされる。</li>
  </ul>
  <button class="btn pri" data-act="rules-close">閉じる</button>
  ${S.phase!=='title'?'<button class="btn" data-act="title">タイトルへ戻る</button>':''}
  </div></div>`;
}

function render(){
  let html=S.phase==='title'?titleView():S.phase==='setup'?setupView():gameView();
  if(S.showRules) html+=rulesView();
  app.innerHTML=html;
}

/* ===== ゲーム進行 ===== */
function startGame(){
  S.p.def=arrange(S.sel,S.jpos).map(v=>({v,open:false}));
  S.p.hand=VALS.filter(v=>!S.sel.includes(v));
  S.plan=pickDefensePlan();
  const preset=S.plan.def;
  S.c.def=preset.map(v=>({v,open:false}));
  S.c.hand=VALS.filter(v=>!preset.includes(v));
  // この試合のCPUの慎重さ（ジョーカーと1をどれだけ温存するか）。試合ごとに変わるので、解禁のタイミングも毎回ばらける
  S.caution=Math.exp(Math.log(0.55)+Math.random()*(Math.log(2.2)-Math.log(0.55)));
  S.patience=-0.3+Math.random()*0.7; // 解禁が始まる進み具合のずれ（マイナスなら早め、プラスなら遅め）
  S.first=Math.random()<.5?'p':'c';
  S.phase='start';
  render();
}

function beginTurn(who){
  S.turn=who;S.result=null;S.decl=null;S.anim=null;S.selCard=null;S.selSlot=null;S.swHand=null;S.swDef=null;S.msg='';
  if(who==='p'){S.phase='p_attack';render();}
  else cpuTurn();
}

function resolve(att,card,slot,forced,chain){
  const A=att==='p'?S.p:S.c, D=att==='p'?S.c:S.p, other=att==='p'?'c':'p';
  A.hand.splice(A.hand.indexOf(card),1);
  A.used.push(card);
  const dv=D.def[slot].v, win=forced!==undefined?forced:beats(card,dv);
  if(win) D.def[slot].open=true;
  else if(forced===undefined){ // オークションで守った時は、守備札の強さの手がかりにならない
    if(att==='p') S.notes[slot].push(card);
    else S.cfails[slot].push({a:card,pre:!S.p.skill}); // pre＝あなたがスキルを使う前に負けた攻撃（入れ替え前の札への手がかり）
  }
  let end=null,next=null;
  if(D.def.every(d=>d.open)) end={type:'all',loser:other};
  else{
    if(win) next=A.hand.length?att:(D.hand.length?other:null);
    else next=D.hand.length?other:(A.hand.length?att:null);
    if(next===null) end={type:'score'};
  }
  S.result={att,card,slot,dv,win,next,end,chain:chain||null};
  S.anim=win?{side:other,slot}:null;
  S.decl=null;S.auc=null;S.aucSel=null;
  S.phase='resolving';
  render();
}

function finish(end){
  S.phase='over';S.revealAll=true;S.anim=null;S.turn=null;
  const ps=sumOpen(S.p),cs=sumOpen(S.c),pc=cntOpen(S.p),cc=cntOpen(S.c);
  let res;
  if(end.type==='all') res=end.loser==='c'?'win':'lose';
  else if(ps!==cs) res=ps<cs?'win':'lose';
  else if(pc!==cc) res=pc<cc?'win':'lose';
  else res='draw';
  S.final={res,detail:`失点　あなた ${ps}（${pc}枚）／ CPU ${cs}（${cc}枚）`};
  S.msg=res==='win'?'あなたの勝ち':res==='lose'?'あなたの負け':'引き分け';
  render();
}

/* ===== CPU ===== */
// 強い札・テクニカルな札（ジョーカー、1、10以上）
const valuable=v=>v==='J'||v===1||v>=10;
// 手札に置いておく価値（守備札に回す時は、価値が低い札から出す）
const keepKey=h=>h==='J'?100:(h===1?50:h);
// 攻撃札が噛み合わない時、守備札に伏せてる強い札・テクニカルな札を手札に回収する
function cpuRecover(bestP){
  const c=S.c;
  if(!canSkill(c)||bestP>=0.3||Math.random()>lv().rec) return false;
  const rs=v=>v==='J'?100:(v===1?3:v);
  const cands=c.def.map((d,i)=>({v:d.v,i})).filter(x=>!c.def[x.i].open&&valuable(x.v)).sort((a,b)=>rs(b.v)-rs(a.v));
  if(!cands.length) return false;
  const give=c.hand.slice().sort((a,b)=>keepKey(a)-keepKey(b))[0];
  doSwap(c,give,cands[0].i);
  return true;
}
// 作戦に沿ったスキル：回収型は「予定の時期」になったら守備のジョーカー（か1）を手札に戻す。
// ブラフ型は、ジョーカー・1を守備に入れてないのに、回収したように見せかけて、ほぼ同格の札と入れ替える。
function cpuPlanMove(){
  const c=S.c,pl=S.plan;
  if(!pl||!canSkill(c)) return false;
  const prog=Math.max(c.used.length/7,cntOpen(S.p)/5*0.9);
  if(pl.rec&&prog>=pl.recAt&&Math.random()<0.6){
    const jAlive=cpuKnown().includes('J');
    const t=c.def.map((d,i)=>({v:d.v,i})).filter(x=>!c.def[x.i].open&&(x.v==='J'||(x.v===1&&jAlive)))
      .sort((a,b)=>(a.v==='J'?0:1)-(b.v==='J'?0:1));
    if(t.length){
      const give=c.hand.slice().sort((a,b)=>keepKey(a)-keepKey(b))[0];
      doSwap(c,give,t[0].i);
      return true;
    }
  }
  if(pl.bluff&&prog>=pl.bluffAt&&Math.random()<0.6){
    const cand=[];
    c.def.forEach((d,i)=>{
      if(d.open||d.v==='J'||d.v===1) return;
      c.hand.forEach(h=>{if(h!=='J'&&h!==1) cand.push({i,h,diff:Math.abs(pts(h)-pts(d.v))});});
    });
    if(cand.length){
      cand.sort((a,b)=>a.diff-b.diff);
      const t=cand[Math.min(cand.length-1,rnd(3))];
      doSwap(c,t.h,t.i);
      return true;
    }
  }
  return false;
}
// 攻撃札の数字と勝ち負けを見てから、伏せてる強い札・テクニカルな札が負けそうな時だけ、守れる札と入れ替えて回収する
function cpuDefend(card,slot){
  const c=S.c;
  if(!canSkill(c)) return false;
  const dv=c.def[slot].v;
  if(!valuable(dv)||!beats(card,dv)) return false;
  const opts=c.hand.filter(h=>!beats(card,h));
  if(!opts.length||Math.random()>lv().def) return false;
  opts.sort((a,b)=>keepKey(a)-keepKey(b));
  doSwap(c,opts[0],slot);
  return true;
}

// CPUの推測：あなたの伏せ守備札として矛盾しない並びを全部数え上げる
function cpuKnown(){ // まだ場に出てない（あなたの守備札か手札のどこかにある）札
  const known=new Set();
  S.p.def.forEach(d=>{if(d.open)known.add(d.v);});
  S.p.used.forEach(v=>known.add(v));
  return VALS.filter(v=>!known.has(v));
}
function cpuBeliefs(useFails){
  const p=S.p;
  const pool=cpuKnown();
  const hidden=p.def.map((d,i)=>d.open?-1:i).filter(i=>i>=0);
  const m=hidden.length,res=[];
  const tryFill=(vals)=>{
    const full=p.def.map(d=>d.v);
    hidden.forEach((slot,j)=>{full[slot]=vals[j];});
    if(!(p.skill?relaxedOK(full):orderOK(full))) return;
    if(useFails&&!hidden.every((slot,j)=>S.cfails[slot].every(f=>!beats(f.a,vals[j])))) return;
    res.push(full);
  };
  const combo=(start,chosen)=>{
    if(chosen.length===m){
      const nums=chosen.filter(v=>v!=='J').sort((a,b)=>a-b);
      if(chosen.includes('J')){
        for(let k=0;k<=nums.length;k++){const v=nums.slice();v.splice(k,0,'J');tryFill(v);}
      }else tryFill(nums);
      return;
    }
    for(let k=start;k<pool.length;k++){chosen.push(pool[k]);combo(k+1,chosen);chosen.pop();}
  };
  combo(0,[]);
  return res;
}

// ---- 強いCPU：あなたの伏せ札と手札の推理 ----
// 仮説＝「あなたの守備札5枚（F）」と「あなたの手札（H）」の組み合わせに、確からしさ（w）を付けたもの。
// ・最初の並びは必ず「左が弱く右が強い」なので、スキル前の並びはそのルールで数え上げる
// ・あなたがスキルを使った後は、「元の並びのどこか1枚を、手札の1枚と入れ替えた」ものとして仮説を作る
//   （守備中に使ったなら、狙われた場所を替えた可能性を高くする。回収したのは強い札・テクニカルな札だった可能性も高くする）
// ・オークションを仕掛けてきたなら、その札は負けそうだった可能性を高くする
const HYP_CAP=2200;
function enumOrdered(hiddenSlots,openVals,pool){
  const m=hiddenSlots.length,res=[];
  const check=vals=>{const full=openVals.slice();hiddenSlots.forEach((s,k)=>{full[s]=vals[k];});return orderOK(full);};
  const combo=(start,chosen)=>{
    if(chosen.length===m){
      const nums=chosen.filter(v=>v!=='J').sort((a,b)=>a-b);
      if(chosen.includes('J')){for(let k=0;k<=nums.length;k++){const v=nums.slice();v.splice(k,0,'J');if(check(v))res.push(v);}}
      else if(check(nums))res.push(nums);
      return;
    }
    for(let k=start;k<pool.length;k++){chosen.push(pool[k]);combo(k+1,chosen);chosen.pop();}
  };
  combo(0,[]);
  return res;
}
function capHyps(h){
  if(h.length<=HYP_CAP) return h;
  for(let i=0;i<HYP_CAP;i++){const j=i+rnd(h.length-i);const t=h[i];h[i]=h[j];h[j]=t;}
  return h.slice(0,HYP_CAP);
}
function cpuHypsSmart(useFails=true){
  const p=S.p,pool=cpuKnown();
  const open=[],hidden=[];
  p.def.forEach((d,i)=>(d.open?open:hidden).push(i));
  const openVals=p.def.map(d=>d.open?d.v:null);
  const hyps=[];
  const sigW=F=>{let w=1;for(const g of S.psig) w*=beats(g.card,F[g.slot])?1:0.15;return w;};
  // 過去に負けた攻撃札との矛盾チェック（入れ替えた場所は、入れ替え前の記録は元の札、後の記録は今の札に当てはめる）
  const failsOK=(F,j,x,h)=>{
    for(const i of hidden.concat(j>=0&&!hidden.includes(j)?[j]:[])){
      for(const f of S.cfails[i]){
        const v=(i===j)?(f.pre?x:h):F[i];
        if(beats(f.a,v)) return false;
      }
    }
    return true;
  };
  if(!p.skill){
    for(const O of enumOrdered(hidden,openVals,pool)){
      const F=openVals.slice();hidden.forEach((s,k)=>{F[s]=O[k];});
      if(useFails&&!failsOK(F,-1)) continue;
      const w=sigW(F);
      hyps.push({F,H:pool.filter(v=>!O.includes(v)),w});
    }
    return capHyps(hyps);
  }
  // スキル後：捲られた札同士の並びが崩れていたら、その捲られた札の場所が入れ替え先
  const openSeq=open.map(i=>openVals[i]);
  let wild=[null];
  if(!orderOK(openSeq)){
    const ws=open.filter(w=>orderOK(open.filter(i=>i!==w).map(i=>openVals[i])));
    if(ws.length) wild=ws;
  }
  const sk=S.pSkill;
  for(const w of wild){
    const slots=w===null?hidden:hidden.concat([w]).sort((a,b)=>a-b);
    const ov=openVals.slice();if(w!==null) ov[w]=null;
    const Os=enumOrdered(slots,ov,pool);
    if(!Os.length||!hidden.length) continue;
    let got=0;
    for(let t=0;t<7000&&got<1500;t++){
      const O=Os[rnd(Os.length)];
      const j=w!==null?w:hidden[rnd(hidden.length)];
      const x=O[slots.indexOf(j)];
      let h;
      if(w!==null) h=openVals[w];
      else{const cand=pool.filter(v=>!O.includes(v));if(!cand.length) continue;h=cand[rnd(cand.length)];}
      const F=openVals.slice();slots.forEach((s,q)=>{F[s]=O[q];});F[j]=h;
      if(useFails&&!failsOK(F,j,x,h)) continue;
      let wt=sigW(F);
      if(sk&&sk.kind==='def'){
        const s=sk.slot,a=sk.card;
        if(j===s) wt*=4*(beats(a,x)?1:0.05)*(!beats(a,h)?1:0.05);
        else wt*=0.5*(beats(a,F[s])?1:0.2);
      }
      if(valuable(x)) wt*=2;
      hyps.push({F,H:pool.filter(v=>!F.includes(v)),w:wt});got++;
    }
  }
  return hyps;
}
function cpuHypsAny(){
  let hy=cpuHypsSmart(true);
  if(hy.length<(S.p.skill?8:1)) hy=cpuHypsSmart(false);
  if(!hy.length){ // 矛盾して数え上げられない時は、並びを無視して適当に散らす
    const pool=cpuKnown(),hidden=S.p.def.map((d,i)=>d.open?-1:i).filter(i=>i>=0);
    for(let t=0;t<300;t++){
      const sh=pool.slice().sort(()=>Math.random()-.5),F=S.p.def.map(d=>d.v);
      hidden.forEach((s,k)=>{F[s]=sh[k];});
      hy.push({F,H:sh.slice(hidden.length),w:1});
    }
  }
  return hy;
}
// ---- ジョーカーと1の解禁 ----
// J・1には「温存する価値」を付けて、攻撃札を選ぶ時の点数から引く。
// 温存する価値は、試合の進み具合や状況で小さくなる（＝解禁される）。決め打ちの時期はなく、試合ごとの慎重さ（S.caution）でも変わる。
//  ・攻撃札を使った枚数、こちらが捲った守備札の数が増えるほど解禁
//  ・相手の伏せ守備が残り2枚以下（決めにいく場面）、自分の守備が3枚以上捲られてる（追い込まれた場面）、手札が2枚以下（使い切れないと無駄）は強く解禁
//  ・点数で負けてたら少し解禁、勝ってたら少し温存
// 1は「相手のジョーカーがまだ場に出てない」間だけ価値がある。相手のジョーカーが出た後は、ただの捨て駒なので温存しない。
//   また、ある守備札がジョーカーである確率が高いほど、その守備への1の攻撃は選ばれやすい。
function reserveState(){
  const c=S.c,p=S.p,L=lv();
  const prog=Math.max(c.used.length/7,cntOpen(p)/5*0.9);
  let rel=(prog-0.25-S.patience)/0.5;
  if(p.def.filter(d=>!d.open).length<=2) rel+=0.6;
  if(cntOpen(c)>=3) rel+=0.5;
  if(c.hand.length<=2) rel+=0.6;
  const lead=sumOpen(p)-sumOpen(c); // プラス＝CPUが点数で有利
  if(lead<=-6) rel+=0.3; else if(lead>=6) rel-=0.2;
  rel=Math.max(0,Math.min(1,rel));
  const jGone=!cpuKnown().includes('J');
  return {rel,jGone,resJ:L.resJ*S.caution*(1-rel),res1:jGone?0:L.res1*S.caution*(1-rel)};
}
function applyReserve(cands,pJof){
  const R=reserveState(),L=lv();
  let jit=0.5+Math.random()*1.0; // 手ごとの気まぐれ（同じ状況でも、たまに早めに解禁する）
  if(Math.random()<(S.c.used.length===0?0.02:0.2)/Math.max(0.6,S.caution)) jit=0; // たまに、その手だけ温存をやめる
  for(const x of cands){
    if(x.card==='J') x.u-=R.resJ*jit;
    else if(x.card===1){
      const pj=pJof(x.slot);
      x.u=pj*22-0.3-R.res1*jit*(1-Math.min(1,2*pj))+Math.random()*L.noise;
    }
  }
  return R;
}
// 何も考えずに選ぶ時も、J・1は解禁されるまで選ばない
function randomPick(cands,R){
  const ok=R.rel>=0.5?cands:cands.filter(x=>x.card!=='J'&&x.card!==1);
  const pool=ok.length?ok:cands;
  return pool[rnd(pool.length)];
}

// ---- 攻撃札の選び方：勝てる見込み・得点・「余り」 ----
// 勝った時に得るのは、捲れた守備札の点数だけ。強い札で勝っても得は同じなので、
// 「その守備札に勝てる、手札の中でいちばん弱い札」との差（手札の何枚分ずれてるか）を「余り」として、点数から引く。
// 2に13で勝つより、2に3で勝つ方がいい、という考え方。
// さらに、その札を使うと「あとで、ちょうどこの札が必要になる守備札」を割れなくなるので、その分も点数から引く（強い札ほど、強い守備札が残っている間は温存される）。
function slotDists(){
  const L=lv(),dists={};
  const hidden=S.p.def.map((d,i)=>d.open?-1:i).filter(i=>i>=0);
  if(L.smart){
    for(const y of cpuHypsAny()) hidden.forEach(i=>{const d=dists[i]||(dists[i]={});d[y.F[i]]=(d[y.F[i]]||0)+y.w;});
  }else if(L.order){
    let A=cpuBeliefs(true);if(!A.length)A=cpuBeliefs(false);
    for(const arr of A) hidden.forEach(i=>{const d=dists[i]||(dists[i]={});d[arr[i]]=(d[arr[i]]||0)+1;});
  }
  if(!hidden.every(i=>dists[i])){ // 弱いCPU、または推理が矛盾して数え上げられない時は、並びのルールを使わず、残りの札からざっくり見積もるだけ
    const pool=cpuKnown();
    hidden.forEach(i=>{const d=dists[i]={};pool.forEach(v=>{d[v]=1;});});
  }
  return dists;
}
function cpuPick(){
  const c=S.c,L=lv();
  const dists=slotDists();
  const hand=c.hand.slice().sort((x,y)=>ORD(x)-ORD(y));
  const rank=new Map(hand.map((h,k)=>[h,k]));
  const cands=[],pJ={};
  for(const key of Object.keys(dists)){
    const i=Number(key),d=dists[key];
    let W=0,E=0;
    for(const v of Object.keys(d)){const w=d[v],val=pv(v);W+=w;E+=w*pts(val);}
    E/=W;
    pJ[i]=(d['J']||0)/W;
    // 守備札の値ごとに、それに勝てる手札の中でいちばん弱い札の順位
    const suf={};
    for(const v of Object.keys(d)) suf[v]=hand.findIndex(h=>beats(h,pv(v)));
    for(const a of hand){
      let pw=0,sw=0;
      for(const v of Object.keys(d)){
        if(beats(a,pv(v))){pw+=d[v];sw+=d[v]*(rank.get(a)-suf[v]);}
      }
      const p=pw/W,sur=sw/W;
      // あとで「ちょうどこの札が必要になる」他の守備札の価値（今使うと、それを割れなくなる）
      let fv=0;
      for(const k2 of Object.keys(dists)){
        if(Number(k2)===i) continue;
        const d2=dists[k2];let W2=0;for(const v of Object.keys(d2)) W2+=d2[v];
        for(const v of Object.keys(d2)){
          const idx=hand.findIndex(h=>beats(h,pv(v)));
          if(idx>=0&&hand[idx]===a) fv+=d2[v]/W2*(pts(pv(v))+6);
        }
      }
      const cost=a==='J'?7:(a===1?0.3:a*L.costK);
      cands.push({u:p*(E+6)-cost-L.margin*sur-L.futK*fv+Math.random()*L.noise,card:a,slot:i,p});
    }
  }
  if(!cands.length){ // 念のため：候補が作れなかった時は、適当に選ぶ
    const slots=S.p.def.map((d,i)=>d.open?-1:i).filter(i=>i>=0);
    return {u:0,card:c.hand[rnd(c.hand.length)],slot:slots[rnd(slots.length)],p:0.5};
  }
  const R=applyReserve(cands,i=>pJ[i]||0);
  if(Math.random()<L.sloppy) return randomPick(cands,R);
  return cands.reduce((b,x)=>(!b||x.u>b.u)?x:b,null);
}

/* ===== オークション ===== */
function expectedSlotPts(slot){
  if(lv().smart){
    const HY=cpuHypsAny();let W=0,E=0;
    for(const y of HY){W+=y.w;E+=y.w*pts(y.F[slot]);}
    return E/W;
  }
  if(!lv().order){const pool=cpuKnown();return pool.reduce((sum,x)=>sum+pts(x),0)/pool.length;}
  let A=cpuBeliefs(true);
  if(!A.length) A=cpuBeliefs(false);
  return A.reduce((sum,arr)=>sum+pts(arr[slot]),0)/A.length;
}
// CPUが今の入札に上書きするか。する場合は出す札（いちばん弱い有効札）を返す。降りるならnull
function cpuAucChoice(){
  const a=S.auc,c=S.c;
  const opts=bidOpts('c').sort((x,y)=>ORD(x)-ORD(y));
  if(!opts.length) return null;
  const h=opts[0];
  if(a.bids.length>=2&&Math.random()<0.5) return null; // 競り合いが長引いたら降りやすい
  const stake=a.att==='c'?6+expectedSlotPts(a.slot):6+pts(c.def[a.slot].v)+2*cntOpen(c);
  const cost=cardVal(h)*0.9;
  return stake*(0.55+Math.random()*0.4)*lv().aucResp>=cost?h:null;
}
function cBid(h){
  const c=S.c;
  c.hand.splice(c.hand.indexOf(h),1);
  c.used.push(h);
  S.auc.top={card:h,by:'c'};
  S.auc.bids.push({card:h,by:'c'});
}
function finishAuction(){
  const a=S.auc,attackerWins=a.top.by===a.att;
  resolve(a.att,a.card,a.slot,attackerWins,aucChain());
}
// CPUが入札した後：あなたが上書きできなければオークション終了
function afterCpuBid(){
  if(!bidOpts('p').length){finishAuction();return;}
  S.phase='auc_me';S.aucSel=null;render();
}
// あなたが入札した後：CPUが上書きするか降りる
function cpuAucRespond(){
  const snap=S;
  S.phase='auc_cpu';render();
  setTimeout(()=>{
    if(S!==snap) return;
    const h=cpuAucChoice();
    if(h==null){finishAuction();return;}
    cBid(h);afterCpuBid();
  },900);
}
// あなたの攻撃に対して、CPUが守れない時にオークションを仕掛ける
function cpuAuctionDefense(card,slot){
  const c=S.c,dv=c.def[slot].v;
  if(!aucAllowed(card)) return false;
  if(!beats(card,dv)) return false;
  if(!c.hand.some(h=>beats(h,card))) return false;
  // 自分から仕掛けるのは、守備札が大きく捲られそうな時だけ、しかも毎回ではない
  if(pts(dv)+3*cntOpen(c)<7||Math.random()>0.6*lv().aucStart) return false;
  S.auc={att:'p',slot,card,top:{card,by:'p'},bids:[]};
  const h=cpuAucChoice();
  if(h==null){S.auc=null;return false;}
  cBid(h);
  return true;
}

function cpuTurn(){
  const snap=S;
  S.phase='c_thinking';S.msg='';render();
  setTimeout(()=>{
    if(S!==snap) return;
    if(cpuPlanMove()||cpuRecover(cpuPick().p)){
      S.notes=fresh();
      S.msg='CPUがスキルを使った';render();
      setTimeout(()=>{if(S!==snap)return;cDeclare();},1100);
    }else cDeclare();
  },900);
}

function cDeclare(){
  const snap=S,b=cpuPick();
  S.decl={card:b.card,slot:b.slot};
  S.msg='';
  if(canSkill(S.p)||canAuction(S.p,b.card)){
    S.phase='p_defend_prompt';render();
  }else{
    S.phase='c_declared';render();
    setTimeout(()=>{if(S!==snap||S.phase!=='c_declared')return;resolve('c',b.card,b.slot);},1500);
  }
}

/* ===== 操作 ===== */
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-act]');
  if(!el) return;
  const act=el.dataset.act,snap=S;
  switch(act){
    case 'rules':S.showRules=true;render();break;
    case 'rules-close':S.showRules=false;render();break;
    case 'pick':{
      const v=pv(el.dataset.v),k=S.sel.indexOf(v);
      if(k>=0)S.sel.splice(k,1);else if(S.sel.length<5)S.sel.push(v);
      render();break;
    }
    case 'jleft':{const a=arrange(S.sel,S.jpos);const k=a.indexOf('J');if(k>0)S.jpos=k-1;render();break;}
    case 'jright':{const a=arrange(S.sel,S.jpos);const k=a.indexOf('J');if(k>=0&&k<a.length-1)S.jpos=k+1;render();break;}
    case 'confirm-def':if(S.sel.length===5)startGame();break;
    case 'begin':beginTurn(S.first);break;
    case 'hand':{
      const v=pv(el.dataset.v);
      if(S.phase==='auc_me'){if(bidOK(v,'p'))S.aucSel=S.aucSel===v?null:v;}
      else if(S.phase==='p_attack'){S.selCard=S.selCard===v?null:v;S.msg='';}
      else if(S.phase==='p_skill_atk'||S.phase==='p_skill_def')S.swHand=S.swHand===v?null:v;
      render();break;
    }
    case 'cslot':{
      const i=Number(el.dataset.i);
      if(S.phase==='p_attack'){S.selSlot=S.selSlot===i?null:i;S.msg='';}
      render();break;
    }
    case 'pslot':{
      const i=Number(el.dataset.i);
      if(S.phase==='p_skill_atk'||S.phase==='p_skill_def')S.swDef=S.swDef===i?null:i;
      render();break;
    }
    case 'skill':
      if(S.phase==='p_attack'&&canSkill(S.p)){
        S.phase='p_skill_atk';S.swHand=null;S.swDef=null;S.msg='';render();
      }break;
    case 'skill-def':
      if(S.phase==='p_defend_prompt'&&canSkill(S.p)){
        S.phase='p_skill_def';S.swHand=null;S.swDef=null;render();
      }break;
    case 'auction':
      if(S.phase==='p_defend_prompt'&&canAuction(S.p,S.decl.card)){
        S.auc={att:'c',slot:S.decl.slot,card:S.decl.card,top:{card:S.decl.card,by:'c'},bids:[]};
        S.aucSel=null;S.phase='auc_me';render();
      }break;
    case 'bid':{
      if(S.phase!=='auc_me'||S.aucSel==null||!bidOK(S.aucSel,'p'))break;
      const v=S.aucSel;
      // あなたが守備側で最初に入札した＝その守備札は負けそうだった、というCPUへの手がかり
      if(S.auc.att==='c'&&S.auc.bids.length===0) S.psig.push({slot:S.auc.slot,card:S.auc.card});
      S.p.hand.splice(S.p.hand.indexOf(v),1);
      S.p.used.push(v);
      S.auc.top={card:v,by:'p'};S.auc.bids.push({card:v,by:'p'});
      S.aucSel=null;
      cpuAucRespond();
      break;
    }
    case 'auc-pass':
      if(S.phase!=='auc_me')break;
      if(S.auc.bids.length===0){ // まだ入札してない＝やめる
        S.auc=null;S.aucSel=null;S.phase='p_defend_prompt';render();
      }else finishAuction();
      break;
    case 'skill-cancel':
      if(S.phase==='p_skill_atk'){S.phase='p_attack';render();}
      else if(S.phase==='p_skill_def'){S.phase='p_defend_prompt';render();}
      break;
    case 'do-swap':{
      if(S.swHand==null||S.swDef==null)break;
      const from=S.phase;
      doSwap(S.p,S.swHand,S.swDef);
      S.pSkill=from==='p_skill_atk'?{kind:'atk'}:{kind:'def',slot:S.decl.slot,card:S.decl.card};
      if(!lv().smart) S.cfails=fresh(); // 強いCPUは、入れ替え前の記録も「入れ替え前の札の手がかり」として残す
      S.swHand=null;S.swDef=null;
      if(from==='p_skill_atk'){
        S.phase='p_attack';S.selCard=null;S.selSlot=null;S.msg='';render();
      }else if(from==='p_skill_def'){
        S.phase='c_thinking';S.msg='CPUが攻撃をやり直す';render();
        setTimeout(()=>{if(S!==snap)return;cDeclare();},1100);
      }
      break;
    }
    case 'attack':{
      if(S.phase!=='p_attack'||S.selCard==null||S.selSlot==null)break;
      const card=S.selCard,slot=S.selSlot;
      if(cpuDefend(card,slot)){
        S.notes=fresh();S.selCard=null;S.selSlot=null;
        S.msg='CPUがスキルを使った（攻撃は中断）';render();
      }else if(cpuAuctionDefense(card,slot)){
        S.selCard=null;S.selSlot=null;afterCpuBid();
      }else resolve('p',card,slot);
      break;
    }
    case 'accept':
      if(S.phase==='p_defend_prompt')resolve('c',S.decl.card,S.decl.slot);
      break;
    case 'next':
      if(S.phase==='resolving'){
        const r=S.result;
        if(r.end)finish(r.end);else beginTurn(r.next);
      }
      break;
    case 'play':case 'restart':S=newGame('setup');render();break;
    case 'level':LEVEL=Number(el.dataset.n);S.level=LEVEL;render();break;
    case 'title':S=newGame('title');render();break;
  }
});

render();
})();
