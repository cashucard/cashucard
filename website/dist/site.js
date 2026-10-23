"use strict";
(() => {
  const $ = (s) => document.querySelector(s);
  const root = document.documentElement;
  const film = $(".story-film");
  const tabs = [...document.querySelectorAll(".story-steps [role=tab]")];
  const playButton = $(".story-play");
  const motionButton = $(".motion-toggle");
  const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
  const stages = [
    {label:"PROVISION",title:"The applet goes on the card.",copy:"A provisioner prepares the card for its holder.",calls:["APPLET INSTALLED","READY FOR HOLDER"],badge:"READY FOR HOLDER"},
    {label:"LOAD",title:"The holder loads ecash.",copy:"Their wallet sets the owner key and loads mint-issued proofs.",calls:["HOLDER OWNS KEY","PROOFS ON CARD"],badge:"ECASH LOADED"},
    {label:"TAP",title:"The card authorizes a spend.",copy:"It signs the terminal's request. The mint has not settled yet.",calls:["NFC REQUEST","CARD SIGNATURE"],badge:"AUTHORIZED · PENDING"},
    {label:"SETTLE",title:"The mint settles the payment.",copy:"The terminal redeems proofs and completes the change flow.",calls:["PROOFS REDEEMED","CHANGE RETURNED"],badge:"PAYMENT SETTLED"},
  ];
  let current=0, playing=false, autoPlayed=false, explicitMotion=false, timer;
  function setPlayLabel(label){
    playButton.setAttribute("aria-label",label+" story");
    $(".play-label").textContent=label;
    playButton.querySelector("span[aria-hidden]").textContent=label==="Pause"?"Ⅱ":"▶";
  }
  function stopPlay(){clearTimeout(timer);playing=false;setPlayLabel("Replay")}
  function selectStage(index, animate=true){
    current=index;
    const stage=stages[index];
    film.classList.remove("is-animating");
    film.dataset.step=String(index);
    film.dataset.phase="ready";
    $("#film-number").textContent=String(index+1).padStart(2,"0")+" / 04";
    $("#film-status").textContent=String(index+1).padStart(2,"0")+" / "+stage.label;
    $(".detail-number").textContent=String(index+1).padStart(2,"0")+" / "+stage.label;
    $("#detail-title").textContent=stage.title;
    $("#detail-copy").textContent=stage.copy;
    $("#callout-one").textContent=stage.calls[0];
    $("#callout-two").textContent=stage.calls[1];
    $("#film-badge").textContent=stage.badge;
    $("#story-panel").setAttribute("aria-labelledby","step-"+index);
    tabs.forEach((tab,i)=>{tab.setAttribute("aria-selected",String(i===index));tab.tabIndex=i===index?0:-1});
    if(animate && root.dataset.motion!=="reduce"){
      void film.offsetWidth;
      film.classList.add("is-animating");
      film.dataset.phase="playing";
    }
  }
  function advance(){
    if(!playing)return;
    if(current===stages.length-1){stopPlay();return}
    selectStage(current+1);
    timer=setTimeout(advance,3200);
  }
  function startPlay(){
    if(root.dataset.motion==="reduce")return;
    clearTimeout(timer);autoPlayed=true;playing=true;setPlayLabel("Pause");
    selectStage(0);timer=setTimeout(advance,3200);
  }
  function setMotion(reduce){
    root.dataset.motion=reduce?"reduce":"full";
    motionButton.setAttribute("aria-pressed",String(reduce));
    motionButton.replaceChildren(document.createTextNode(reduce?"Enable motion ":"Reduce motion "));
    const symbol=document.createElement("span");symbol.setAttribute("aria-hidden","true");symbol.textContent=reduce?"↗":"◌";motionButton.append(symbol);
    playButton.disabled=reduce;
    playButton.title=reduce?"Choose a step to explore the flow":"";
    if(reduce){if(playing)stopPlay();film.classList.remove("is-animating");film.dataset.phase="ready"}
  }
  setMotion(motionPreference.matches);
  motionButton.addEventListener("click",()=>{explicitMotion=true;setMotion(root.dataset.motion!=="reduce")});
  motionPreference.addEventListener("change",e=>{if(!explicitMotion)setMotion(e.matches)});
  tabs.forEach(tab=>tab.addEventListener("click",()=>{if(playing)stopPlay();autoPlayed=true;selectStage(Number(tab.dataset.step))}));
  $(".story-steps").addEventListener("keydown",e=>{
    const index=tabs.indexOf(document.activeElement);if(index<0)return;
    let next;
    if(["ArrowRight","ArrowDown"].includes(e.key))next=(index+1)%tabs.length;
    else if(["ArrowLeft","ArrowUp"].includes(e.key))next=(index+tabs.length-1)%tabs.length;
    else if(e.key==="Home")next=0;else if(e.key==="End")next=tabs.length-1;else return;
    e.preventDefault();tabs[next].click();tabs[next].focus();
  });
  playButton.addEventListener("click",()=>playing?stopPlay():startPlay());
  if("IntersectionObserver" in window){
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(e=>e.isIntersecting)&&!autoPlayed&&root.dataset.motion!=="reduce"){
        observer.disconnect();startPlay();
      }
    },{threshold:.18});observer.observe($("#story"));
  }
})();
