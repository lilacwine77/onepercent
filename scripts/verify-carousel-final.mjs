import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const out='artifacts/v4';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']});
const report={desktop:{},mobile:{},issues:[],errors:[]};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const url=process.env.PACK_PREVIEW_URL||'http://127.0.0.1:5173';
const issue=(ok,message)=>{if(!ok)report.issues.push(message);};

async function pageAt(width,height,mobile=false){
  const context=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile});
  await context.addInitScript(()=>sessionStorage.setItem('onepercent-v2-seen','1'));
  const page=await context.newPage();
  page.on('pageerror',e=>report.errors.push(`${width}x${height}: ${e.message}`));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{const e=document.querySelector('.token-lineup');scrollTo({top:e.getBoundingClientRect().top+scrollY-150,behavior:'instant'});});
  await page.locator('.token-window').waitFor({state:'visible'});
  await pause(500);
  return {context,page};
}
const position=page=>page.locator('.token-window').evaluate(e=>e.scrollLeft);

try{
  const {context,page}=await pageAt(1440,900);
  const d=report.desktop;
  d.logos=await page.locator('.token-group').first().locator('li').evaluateAll(async els=>Promise.all(els.map(async li=>{
    const img=li.querySelector('img');
    try{await img.decode();}catch{}
    return {ticker:li.querySelector('strong')?.textContent,loaded:img.complete&&img.naturalWidth>0,src:img.getAttribute('src')};
  })));
  issue(d.logos.map(x=>x.ticker).join(',')==='PONS,BUN,NVDA,AI,UBIK,TSLA,BONER,AAPL,AUR,META','ten carousel tickers/order incorrect');
  issue(d.logos.every(x=>x.loaded),'one or more carousel logos failed to decode');
  const box=await page.locator('.token-window').boundingBox();
  const x=box.x+Math.min(190,box.width*.25),y=box.y+box.height/2;
  await page.mouse.move(x,y);
  let a=await position(page);await pause(700);let b=await position(page);
  d.hoverAuto=Math.round(b-a);issue(d.hoverAuto>10,'desktop hover stops auto scroll');
  await page.mouse.down();await pause(550);let c=await position(page);
  d.mouseHeld=Math.round(c-b);issue(Math.abs(d.mouseHeld)<=2,'desktop mouse hold does not pause');
  await page.mouse.move(10,10,{steps:3});let outsideStart=await position(page);await pause(550);let e=await position(page);
  d.dragOutside=Math.round(outsideStart-c);
  d.heldOutside=Math.round(e-outsideStart);issue(Math.abs(d.heldOutside)<=2,'desktop mouse hold outside strip resumes early');
  await page.mouse.up();await pause(750);let f=await position(page);
  d.releasedOutside=Math.round(f-e);issue(d.releasedOutside>10,'desktop mouse release outside strip does not resume');
  await page.locator('.token-window').focus();await page.keyboard.down('Space');
  let g=await position(page);await pause(550);let h=await position(page);
  d.spaceHeld=Math.round(h-g);issue(Math.abs(d.spaceHeld)<=2,'Space hold does not pause');
  await page.keyboard.up('Space');await pause(700);let i=await position(page);
  d.spaceReleased=Math.round(i-h);issue(d.spaceReleased>10,'Space release does not resume');
  await page.mouse.move(10,10);
  await page.locator('.token-next').click();let j=await position(page);await pause(700);let k=await position(page);
  d.nextStep=Math.round(j-i);d.autoAfterNext=Math.round(k-j);
  issue(Math.abs(d.nextStep)>100&&d.autoAfterNext>10,'Next arrow does not step then resume');
  await page.locator('.token-prev').click();let l=await position(page);await pause(700);let m=await position(page);
  d.prevStep=Math.round(l-k);d.autoAfterPrev=Math.round(m-l);
  issue(Math.abs(d.prevStep)>100&&d.autoAfterPrev>10,'Previous arrow does not step then resume');
  await page.mouse.move(x,y);const sy=await page.evaluate(()=>scrollY);
  await page.mouse.wheel(0,300);await pause(700);const ey=await page.evaluate(()=>scrollY);
  d.verticalWheel={before:sy,after:ey,delta:ey-sy};issue(ey-sy>100,'vertical wheel over carousel does not advance page');
  await context.close();

  const {context:mc,page:mp}=await pageAt(390,844,true);const v=report.mobile;
  const mb=await mp.locator('.token-window').boundingBox();
  const sx=mb.x+mb.width*.72,tx=mb.x+mb.width*.28,ty=mb.y+mb.height/2;
  const cdp=await mc.newCDPSession(mp);
  const touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
  let ma=await position(mp);await pause(700);let mbp=await position(mp);
  v.groupWidth=await mp.locator('.token-group').first().evaluate(e=>e.getBoundingClientRect().width);
  v.autoRaw={before:ma,after:mbp};v.auto=Math.round((mbp-ma+v.groupWidth)%v.groupWidth);
  issue(v.auto>10&&v.auto<100,'mobile carousel not automatically moving');
  await touch('touchStart',[{x:sx,y:ty,id:1}]);await pause(500);
  let mh=await position(mp);v.held=Math.round(mh-mbp);issue(Math.abs(v.held)<=2,'mobile touch hold does not pause');
  for(let n=1;n<=5;n++){await touch('touchMove',[{x:sx+(tx-sx)*n/5,y:ty,id:1}]);await pause(35);}
  await touch('touchEnd',[]);let me=await position(mp);await pause(700);let mr=await position(mp);
  v.swipeDistance=Math.round(me-mh);v.afterTouchEnd=Math.round(mr-me);
  issue(v.afterTouchEnd>10,'mobile touch end does not resume auto scroll');
  await touch('touchStart',[{x:sx,y:ty,id:2}]);await pause(450);let mc0=await position(mp);
  await touch('touchCancel',[]);await pause(700);let mc1=await position(mp);
  v.afterTouchCancel=Math.round(mc1-mc0);issue(v.afterTouchCancel>10,'mobile touch cancel does not resume auto scroll');
  await mc.close();
}finally{await browser.close();}
report.passed=!report.issues.length&&!report.errors.length;
await writeFile(`${out}/carousel-final-report.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(!report.passed)process.exitCode=1;
