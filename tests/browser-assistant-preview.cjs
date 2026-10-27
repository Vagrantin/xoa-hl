const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http=require('http'),fs=require('fs/promises'),path=require('path');
const root=path.resolve(__dirname,'..');
const output=process.env.ASSISTANT_SCREENSHOT_DIR || path.join(root,'out','assistant-ui');
const files=new Map([['/docs/assistant-preview.html','text/html'],['/SOURCES/assistant-ui/panel.mjs','text/javascript'],['/SOURCES/assistant-ui/locales.mjs','text/javascript'],['/SOURCES/assistant-ui/panel.css','text/css']]);
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const server=http.createServer(async(req,res)=>{const p=new URL(req.url,'http://localhost').pathname;if(!files.has(p)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',files.get(p)+'; charset=utf-8');res.end(await fs.readFile(path.join(root,p)));});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));let browser;
 try{
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1000,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const lang of ['en','fr','ja']){
   await page.goto(`http://127.0.0.1:${server.address().port}/docs/assistant-preview.html?lang=${lang}`);
   await page.waitForSelector('.xoa-assistant__proposal:not([hidden])');
   if(await page.locator('dt').count()!==9)throw new Error('Incomplete proposal fields');
   await page.screenshot({path:path.join(output,`assistant-preview-${lang}.png`),fullPage:true});
   await page.locator('.xoa-assistant__approve').click();
   await page.waitForFunction(()=>/approved|approuvée|承認しました/.test(document.querySelector('[role=status]').textContent));
  }
  await page.setViewportSize({width:375,height:1000});
  await page.goto(`http://127.0.0.1:${server.address().port}/docs/assistant-preview.html?lang=ja`);
  await page.waitForSelector('.xoa-assistant__proposal:not([hidden])');
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Horizontal overflow');
  await page.screenshot({path:path.join(output,'assistant-preview-mobile-ja.png'),fullPage:true});
  if(errors.length)throw new Error(errors.join('\n'));
  console.log('Chromium preview checks passed: EN/FR/JA, all fields, approval, 375px layout');
 }finally{if(browser)await browser.close();await new Promise(done=>server.close(done));}
})().catch(e=>{console.error(e);process.exitCode=1});
