import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const out = 'artifacts/v5';
await mkdir(out, { recursive: true });
const viewports = [[320,640],[390,844],[768,1024],[900,700],[1024,768],[1440,744],[1920,1080],[844,390]];
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] });
const report = { samples: [], issues: [], errors: [] };
const intersects = (a,b) => Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left)) *
  Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));

try {
  for (const [width,height] of viewports) {
    const context = await browser.newContext({viewport:{width,height},isMobile:width<=390,hasTouch:width<=390});
    await context.addInitScript(() => sessionStorage.setItem('onepercent-v2-seen','1'));
    const page = await context.newPage();
    page.on('pageerror',e=>report.errors.push(`${width}x${height}: ${e.message}`));
    await page.goto(process.env.PACK_PREVIEW_URL || 'http://127.0.0.1:5173',{waitUntil:'domcontentloaded'});
    await page.locator('#pack-stage[data-ready="true"]').waitFor({timeout:25000}).catch(()=>{});
    await page.waitForTimeout(1800);
    for (const progress of [0,.75]) {
      const travel = await page.evaluate(() => {
        const track=document.querySelector('.hero'),scene=document.querySelector('.hero-frame');
        return track.offsetHeight-scene.offsetHeight+scene.offsetHeight*.15;
      });
      await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),travel*progress);
      await page.waitForTimeout(350);
      const sample=await page.evaluate(() => {
        const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
        const q=s=>document.querySelector(s);
        const copy=q('.hero-copy'),title=q('.hero-copy h1'),body=q('.hero-copy p'),deposit=q('.hero-deposit'),art=q('.hero-art'),cta=q('.hero-cta'),rip=q('.hero-rip');
        const chars=[...title.querySelectorAll('.char')].filter(el=>getComputedStyle(el).display!=='none').map(rect);
        return {scrollY,packProgress:window.packReveal?.target??null,copy:rect(copy),title:rect(title),body:rect(body),deposit:rect(deposit),art:rect(art),cta:rect(cta),rip:rect(rip),chars,
          titleText:title.innerText,bodyText:body.innerText,pageWidth:document.documentElement.scrollWidth,
          frame:rect(q('.hero-frame'))};
      });
      sample.viewport=`${width}x${height}`;sample.progress=progress;
      sample.copyArtOverlap=intersects(sample.copy,sample.art);
      sample.titleArtOverlap=intersects(sample.title,sample.art);
      sample.bodyArtOverlap=intersects(sample.body,sample.art);
      sample.depositArtOverlap=intersects(sample.deposit,sample.art);
      sample.copyCtaOverlap=intersects(sample.copy,sample.cta);
      sample.copyRipOverlap=intersects(sample.copy,sample.rip);
      sample.charRight=Math.max(...sample.chars.map(r=>r.right),0);
      sample.charLeft=Math.min(...sample.chars.map(r=>r.left),width);
      report.samples.push(sample);
      for (const field of ['copyArtOverlap','titleArtOverlap','bodyArtOverlap','depositArtOverlap','copyCtaOverlap','copyRipOverlap'])
        if(sample[field]>50) report.issues.push(`${sample.viewport} p${progress} ${field} ${Math.round(sample[field])}px²`);
      if(sample.pageWidth>width+2)report.issues.push(`${sample.viewport} p${progress} horizontal overflow ${sample.pageWidth-width}px`);
      if(sample.charLeft<-1||sample.charRight>width+1)report.issues.push(`${sample.viewport} p${progress} title chars outside viewport (${sample.charLeft.toFixed(0)},${sample.charRight.toFixed(0)})`);
      if(!sample.titleText.includes('Dust in,')||!sample.titleText.includes('Packs out.'))report.issues.push(`${sample.viewport} p${progress} title text missing: ${sample.titleText}`);
      if(progress===.75)await page.screenshot({path:`${out}/hero-${width}x${height}-open.png`});
    }
    await context.close();
    console.log(`${width}x${height}: ${report.issues.filter(s=>s.startsWith(`${width}x${height}`)).length} issues`);
  }
} finally {await browser.close();}
report.passed=!report.issues.length&&!report.errors.length;
await writeFile(`${out}/hero-responsive-report.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:report.passed,issues:report.issues,errors:report.errors,report:`${out}/hero-responsive-report.json`},null,2));
if(!report.passed)process.exitCode=1;
