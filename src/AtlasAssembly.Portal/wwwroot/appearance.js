(() => {
  'use strict';
  if (window.AtlasAssemblyAppearance) return;
  const storageKey = 'atlas-assembly:appearance:v1', minimumContrast = 4.5;
  const originals = new Map(), roots = new Set(), parsed = new Map();
  const excluded = 'script,style,link,meta,base,title,template,canvas,video,picture,svg,svg *,[data-appearance-preserve],[data-appearance-preserve] *';
  const surfaces = new Set(['HTML','BODY','HEADER','MAIN','SECTION','ARTICLE','ASIDE','NAV','DIV','FORM','FIELDSET','LEGEND','TABLE','THEAD','TBODY','TFOOT','TR','TH','TD','DETAILS','SUMMARY','FOOTER','INPUT','TEXTAREA','SELECT','OPTION','BUTTON','DIALOG','UL','OL','LI','PRE','CODE','LABEL']);
  let scheduled = false, processing = false, control = null, converter = null, theme = 'dark', repaired = 0, backgroundCache = new WeakMap();
  try { if (localStorage.getItem(storageKey) === 'light') theme = 'light'; } catch { /* Restricted storage keeps the declared dark default. */ }
  document.documentElement.dataset.atlasTheme = theme;

  function color(value) {
    if (parsed.has(value)) return parsed.get(value);
    let result = null;
    if (value === 'transparent') result = [0,0,0,0];
    else {
      const rgb = /^rgba?\(([^)]+)\)$/.exec(value || '');
      const srgb = /^color\(srgb\s+([^)]+)\)$/.exec(value || '');
      if (rgb || srgb) {
        const parts = (rgb || srgb)[1].replace(/,/g,' ').replace(/\//g,' ').trim().split(/\s+/);
        if (parts.length === 3 || parts.length === 4) {
          result = parts.slice(0,3).map(part => part.endsWith('%') ? parseFloat(part)*2.55 : Number(part)*(srgb ? 255 : 1));
          result.push(parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3])/100 : Number(parts[3]));
          if (result.some(value => !Number.isFinite(value))) result = null;
        }
      }
      if(!result&&window.CSS?.supports('color',value||'')){
        if(!converter){const canvas=document.createElement('canvas');canvas.width=canvas.height=1;converter=canvas.getContext('2d',{willReadFrequently:true});}
        if(converter){converter.clearRect(0,0,1,1);converter.fillStyle=value;converter.fillRect(0,0,1,1);const pixel=converter.getImageData(0,0,1,1).data;result=[pixel[0],pixel[1],pixel[2],pixel[3]/255];}
      }
    }
    parsed.set(value,result); return result;
  }
  function over(front,back) { const alpha=front[3]; return [front[0]*alpha+back[0]*(1-alpha),front[1]*alpha+back[1]*(1-alpha),front[2]*alpha+back[2]*(1-alpha),1]; }
  function merge(front,back) { const alpha=front[3]+back[3]*(1-front[3]);if(alpha===0)return [0,0,0,0];return [0,1,2].map(index=>(front[index]*front[3]+back[index]*back[3]*(1-front[3]))/alpha).concat(alpha); }
  function luminance(rgb) { const values=rgb.slice(0,3).map(value=>{const channel=Math.max(0,Math.min(255,value))/255;return channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4;});return values[0]*.2126+values[1]*.7152+values[2]*.0722; }
  function contrast(front,back) { const a=luminance(over(front,back)),b=luminance(back);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05); }
  function opaque(rgb) { return 'rgb('+rgb.slice(0,3).map(value=>Math.round(value)).join(', ')+')'; }
  function readable(original,background) {
    const white=[255,255,255,1],black=[0,0,0,1],target=contrast(white,background)>=contrast(black,background)?white:black;
    if (Math.max(...original.slice(0,3))-Math.min(...original.slice(0,3))<20) return opaque(target);
    let low=0,high=1;
    for(let step=0;step<18;step++){const middle=(low+high)/2,candidate=original.slice(0,3).map((value,index)=>value+(target[index]-value)*middle).concat(1);if(contrast(candidate,background)>=minimumContrast+.15)high=middle;else low=middle;}
    return opaque(original.slice(0,3).map((value,index)=>value+(target[index]-value)*high).concat(1));
  }
  function background(element) {
    if(!element)return theme==='dark'?[16,16,16,1]:[255,255,255,1];
    if(backgroundCache.has(element))return backgroundCache.get(element);
    const own=color(getComputedStyle(element).backgroundColor),result=own?.[3]===1?own:own?over(own,background(element.parentElement)):background(element.parentElement);
    backgroundCache.set(element,result);return result;
  }
  function pixels(element,foreground) {
    let ink=foreground.slice(),paper=[0,0,0,0],invisible=false;
    for(let current=element;current;current=current.parentElement){const style=getComputedStyle(current),paint=color(style.backgroundColor)||[0,0,0,0],opacity=Number(style.opacity);ink=merge(ink,paint);paper=merge(paper,paint);if(Number.isFinite(opacity)){ink[3]*=opacity;paper[3]*=opacity;if(opacity===0)invisible=true;}}
    const base=theme==='dark'?[16,16,16,1]:[255,255,255,1];ink=merge(ink,base);paper=merge(paper,base);
    return {foreground:ink,background:paper,ratio:contrast(ink,paper),invisible};
  }
  function remember(element,property,value,priority) {
    let record=originals.get(element);if(!record){record=new Map();originals.set(element,record);}
    if(!record.has(property))record.set(property,{value:element.style.getPropertyValue(property),priority:element.style.getPropertyPriority(property),applied:null});
    const saved=record.get(property);element.style.setProperty(property,value,priority??saved.priority);saved.applied=element.style.getPropertyValue(property);saved.appliedPriority=element.style.getPropertyPriority(property);
  }
  function restore(element) {
    const record=originals.get(element);if(!record)return;
    for(const [property,saved] of record){const current=element.style.getPropertyValue(property),priority=element.style.getPropertyPriority(property);if(current===saved.applied&&priority===saved.appliedPriority){if(saved.value)element.style.setProperty(property,saved.value,saved.priority);else element.style.removeProperty(property);}else{saved.value=current;saved.priority=priority;}saved.applied=null;saved.appliedPriority=null;}
  }
  function foreground(element,value) {
    remember(element,'color',value);
    const expected=color(value),actual=color(getComputedStyle(element).color);
    if(expected&&actual&&expected.some((channel,index)=>Math.abs(channel-actual[index])>.6))remember(element,'color',value,'important');
  }
  function hasText(element) { return [...element.childNodes].some(node=>node.nodeType===3&&/\S/.test(node.nodeValue||''))||element.matches('input:not([type="hidden"]):not([type="color"]),textarea,select,option,button,summary'); }
  function eligible(element) { return element instanceof Element && !element.matches(excluded) && !element.closest('[hidden],[aria-hidden="true"]') && element.getClientRects().length>0; }
  function repair(element) {
    if(!eligible(element))return;
    restore(element);
    let style=getComputedStyle(element);
    if(style.display==='none'||style.visibility!=='visible'||Number(style.opacity)===0)return;
    const bg=color(style.backgroundColor);
    if(theme==='dark'&&surfaces.has(element.tagName)&&!element.matches('input[type="color"]')&&bg&&bg[3]>.8&&Math.max(...bg.slice(0,3))-Math.min(...bg.slice(0,3))<24&&luminance(bg)>.6){
      remember(element,'background-color',element.matches('input,textarea,select,option,button,th,summary')?'rgb(37, 37, 37)':'rgb(24, 24, 24)');
      style=getComputedStyle(element);
    }
    const base=background(element),ink=color(style.color);
    if(hasText(element)&&ink&&ink[3]>.01){
      let measured=pixels(element,ink);
      if(!measured.invisible&&measured.ratio<minimumContrast){
        foreground(element,readable(ink,measured.background));
        measured=pixels(element,color(getComputedStyle(element).color)||ink);
        if(measured.ratio<minimumContrast){
          for(let current=element;current;current=current.parentElement){const opacity=Number(getComputedStyle(current).opacity);if(opacity>0&&opacity<1){remember(current,'opacity','1');if(Number(getComputedStyle(current).opacity)<1)remember(current,'opacity','1','important');}}
          backgroundCache=new WeakMap();
          const currentInk=color(getComputedStyle(element).color)||ink;measured=pixels(element,currentInk);
          if(measured.ratio<minimumContrast)foreground(element,readable(currentInk,measured.background));
        }
        repaired++;
      }
    }
    if(element.matches('input:not([type="color"]),textarea'))remember(element,'--atlas-placeholder-color',contrast([188,188,188,1],base)>=minimumContrast?'#bcbcbc':'#444');
  }
  function installControl() {
    if(!document.body)return;
    if(!control){control=document.createElement('span');control.setAttribute('data-atlas-appearance-controls','');const button=document.createElement('button');button.type='button';button.addEventListener('click',()=>setTheme(theme==='dark'?'light':'dark'));control.append(button);}
    const destination=document.querySelector('[data-atlas-theme-control]')||document.body;
    if(control.parentElement!==destination)destination.append(control);
    const button=control.firstElementChild;button.textContent=theme==='dark'?'Light theme':'Dark theme';button.setAttribute('aria-label',theme==='dark'?'Switch to light theme':'Switch to dark theme');
  }
  function queue(root) {
    if(root?.nodeType===3)root=root.parentElement;
    if(root instanceof Element)roots.add(root);else if(root===document)roots.add(document.documentElement);
    if(!scheduled){scheduled=true;requestAnimationFrame(flush);}
  }
  const observer=new MutationObserver(mutations=>{for(const mutation of mutations){if(mutation.type==='childList'){for(const node of mutation.addedNodes)queue(node);if(mutation.removedNodes.length)queue(mutation.target);}else queue(mutation.target);}});
  function observe(){observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden','open','disabled','data-atlas-theme']});}
  function flush() {
    scheduled=false;if(processing)return;processing=true;observer.disconnect();
    try{
      backgroundCache=new WeakMap();
      for(const element of originals.keys())if(!element.isConnected){restore(element);originals.delete(element);}
      installControl();
      const candidates=new Set();for(const root of roots){candidates.add(root);for(const element of root.querySelectorAll('*'))candidates.add(element);}roots.clear();
      const ordered=[...candidates].filter(element=>element.isConnected).sort((left,right)=>left===right?0:left.compareDocumentPosition(right)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
      for(const element of ordered)repair(element);
    }finally{processing=false;observe();}
  }
  function setTheme(value) {
    if(!['dark','light'].includes(value))throw new TypeError('Choose dark or light theme.');
    theme=value;document.documentElement.dataset.atlasTheme=theme;
    try{localStorage.setItem(storageKey,theme);}catch{/* The current theme still works when browser storage is restricted. */}
    queue(document);
  }
  function audit() {
    const failures=[];let checked=0;backgroundCache=new WeakMap();
    for(const element of document.querySelectorAll('body *')){
      if(!eligible(element)||!hasText(element))continue;const style=getComputedStyle(element),foreground=color(style.color);if(!foreground||foreground[3]<=.01||style.visibility!=='visible'||Number(style.opacity)===0)continue;
      const measured=pixels(element,foreground);if(measured.invisible)continue;
      checked++;if(measured.ratio<minimumContrast-.01&&failures.length<100)failures.push({element:element.localName,color:style.color,background:opaque(measured.background),ratio:Number(measured.ratio.toFixed(2))});
    }
    return {theme,checked,repaired,failures};
  }
  window.AtlasAssemblyAppearance=Object.freeze({setTheme,refresh:()=>queue(document),audit});
  for(const event of ['pointerover','pointerout','focusin','focusout'])document.addEventListener(event,event=>queue(event.target),{passive:true});
  window.addEventListener('resize',()=>queue(document),{passive:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>queue(document),{once:true});else queue(document);
})();
