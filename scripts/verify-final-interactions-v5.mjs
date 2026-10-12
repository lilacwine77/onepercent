import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const out='artifacts/v5';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']});
const report={heroScreens:[],modal:{},turntable:[],issues:[],errors:[]};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const url=process.env.PACK_PREVIEW_URL||'http://127.0.0.1:5173';
const check=(ok,message)=>{if(!ok)report.issues.push(message);};
async function open(width,height){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,isMobile:width<700,hasTouch:width<700});
  await context.addInitScript(()=>sessionStorage.setItem('onepercent-v2-seen','1'));
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(`${width}: ${e.message}`));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.locator('#pack-stage[data-ready="true"]').waitFor({timeout:30000});
  return {page,context};
}
async function heroScreenshot(page,width,height){
  const travel=await page.evaluate(()=>{const t=document.querySelector('.hero'),s=document.querySelector('.hero-frame');return t.offsetHeight-s.offsetHeight+s.offsetHeight*.15;});
  await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),travel*.75);
  await page.waitForFunction(()=>Math.abs((window.packReveal?.progress??0)-.75)<.04,null,{timeout:5000});
  await wait(1100);
  const path=`${out}/hero-${width}x${height}-gradient-final.png`;
  await page.screenshot({path});report.heroScreens.push(path);
}
const state=page=>page.evaluate(()=>({scrollY,dialogOpen:document.querySelector('#pack-detail').open,wave:!!document.querySelector('.onepercent-wave'),spinProgress:window.spinPack?.progress??null}));
async function modalRace(page){
  await page.locator('.product-card').first().scrollIntoViewIfNeeded();
  await page.locator('.product-card').first().click();
  await page.waitForFunction(()=>document.querySelector('#pack-detail').open,null,{timeout:5000});
  report.modal.escapeStart=await state(page);
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('#pack-detail').open&&!document.querySelector('.onepercent-wave'),null,{timeout:9000});
  report.modal.escapeEnd=await state(page);
  check(!report.modal.escapeEnd.dialogOpen&&!report.modal.escapeEnd.wave,'Escape during opening leaves modal/wave active');
  await page.locator('.product-card').first().click();
  await page.waitForFunction(()=>document.querySelector('#pack-detail').open&&!document.querySelector('.onepercent-wave'),null,{timeout:9000});
  await page.locator('.detail-close').click();
  await page.waitForFunction(()=>!!document.querySelector('.onepercent-wave'),null,{timeout:1500});
  await page.locator('.product-card').first().evaluate(el=>el.click());
  await page.waitForFunction(()=>!document.querySelector('#pack-detail').open&&!document.querySelector('.onepercent-wave'),null,{timeout:9000});
  report.modal.rapidReopenEnd=await state(page);
  check(!report.modal.rapidReopenEnd.dialogOpen,'opening pack while close wave active leaves modal open');
  await page.mouse.move(50,500);const before=await page.evaluate(()=>scrollY);
  await page.mouse.wheel(0,300);await wait(700);const after=await page.evaluate(()=>scrollY);
  report.modal.scrollAfterClose={before,after,delta:after-before};
  check(after-before>100,'Lenis/page scroll remains locked after rapid modal transitions');
}
async function spinSamples(page,width,height){
  await page.waitForFunction(()=>!document.documentElement.classList.contains('lenis-smooth'),null,{timeout:6000});
  const geom=await page.evaluate(()=>{const t=document.querySelector('.turntable'),s=document.querySelector('.turntable-frame');return {top:scrollY+t.getBoundingClientRect().top,height:s.offsetHeight,travel:t.offsetHeight-s.offsetHeight+s.offsetHeight*.15};});
  const H=geom.height,lead=H*.45,ramp=Math.min(lead*2,geom.travel+lead),denom=geom.travel+lead-ramp/2;
  const expectedAt=y=>{const d=Math.max(0,Math.min(denom+ramp/2,lead-(geom.top-y)));return Math.max(0,Math.min(1,(d<ramp?d*d/(2*ramp):d-ramp/2)/denom));};
  const inverse=p=>{const eased=p*denom,d=eased<=ramp/2?Math.sqrt(2*ramp*eased):eased+ramp/2;return geom.top-lead+d;};
  const points=[['entry',0],['entry-half',null],['pin-start',null],['eighth',.125],['quarter',.25],['half',.5],['three-quarter',.75],['release',1]];
  const positions={entry:geom.top-lead,'entry-half':geom.top-lead/2,'pin-start':geom.top,eighth:inverse(.125),quarter:inverse(.25),half:inverse(.5),'three-quarter':inverse(.75),release:inverse(1)};
  for(const [name,exact] of points){
    await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),positions[name]);
    if(name==='entry'){
      try{await page.locator('#spin-stage[data-ready="true"]').waitFor({timeout:8000});}
      catch{
        report.turntableLoadDebug=await page.evaluate(()=>({scrollY,turnTop:document.querySelector('.turntable').getBoundingClientRect().top,spinReady:document.querySelector('#spin-stage').dataset.ready??null,spinExists:!!window.spinPack,wave:!!document.querySelector('.onepercent-wave')}));
        await page.locator('.turntable').scrollIntoViewIfNeeded();
        await page.locator('#spin-stage[data-ready="true"]').waitFor({timeout:22000});
        await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),positions.entry);
      }
    }
    await page.waitForFunction(({y,p})=>Math.abs(scrollY-y)<3&&typeof window.spinPack?.progress==='number'&&Math.abs(window.spinPack.progress-p)<.018,
      {y:positions[name],p:expectedAt(positions[name])},{timeout:5000});
    const sample=await page.evaluate(()=>{const r=s=>{const b=document.querySelector(s).getBoundingClientRect();return {top:b.top,bottom:b.bottom,left:b.left,right:b.right,width:b.width,height:b.height};};return {scrollY,progress:window.spinPack?.progress??null,frame:r('.turntable-frame'),stage:r('#spin-stage'),pageWidth:document.documentElement.scrollWidth,canvasBuffer:(()=>{const c=document.querySelector('#spin-stage canvas');return c?{width:c.width,height:c.height}:null;})()};});
    sample.width=width;sample.point=name;sample.expected=exact;report.turntable.push(sample);
    if(exact!==null)check(Math.abs(sample.progress-exact)<.03,`${width} ${name} progress ${sample.progress} expected ${exact}`);
    if(sample.pageWidth>width+2)report.issues.push(`${width} ${name} horizontal overflow`);
    if(name==='entry')check(sample.progress<.005,`${width} model already rotates before 45vh lead`);
    if(name==='entry-half')check(sample.progress>.005&&sample.progress<.045,`${width} lead-in not gentle`);
    if(name==='pin-start')check(sample.progress>.055&&sample.progress<.11,`${width} pin-start progress outside expected range`);
    if(name==='release')check(Math.abs(sample.frame.top+H*.15)<3,`${width} release frame top not -15vh`);
    if(width===1440&&name==='pin-start'){
      await page.evaluate(()=>window.spinPack?.setProgress(0));await wait(200);
      const clip=await page.locator('#spin-stage').boundingBox();
      await page.screenshot({path:`${out}/signature-front-1440-dpr2.png`,clip});
    }
    if(width===1440&&name==='eighth'){
      const clip=await page.locator('#spin-stage').boundingBox();
      await page.screenshot({path:`${out}/signature-quarter-1440-dpr2.png`,clip});
    }
    if(name==='half')await page.screenshot({path:`${out}/signature-turn-${width}x${height}-half.png`});
  }
  for(const name of ['half','eighth','entry']){
    await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),positions[name]);await wait(450);
    const p=await page.evaluate(()=>window.spinPack?.progress??null);
    report.turntable.push({width,point:`reverse-${name}`,progress:p});
    if(name==='entry')check(p<.005,`${width} reverse does not return to front`);
  }
}
try{
  const desktop=await open(1440,900);await heroScreenshot(desktop.page,1440,900);
  await modalRace(desktop.page);await spinSamples(desktop.page,1440,900);await desktop.context.close();
  const mobile=await open(390,844);await heroScreenshot(mobile.page,390,844);
  await spinSamples(mobile.page,390,844);await mobile.context.close();
}catch(error){report.issues.push(error.stack||String(error));}
finally{await browser.close();}
report.passed=!report.issues.length&&!report.errors.length;
await writeFile(`${out}/final-interactions-report.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:report.passed,issues:report.issues,errors:report.errors,modal:report.modal,
  turntable:report.turntable.map(({width,point,progress})=>({width,point,progress})),report:`${out}/final-interactions-report.json`},null,2));
if(!report.passed)process.exitCode=1;
