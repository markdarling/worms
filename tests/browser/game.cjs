const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const output = mkdtempSync(tmpdir() + '/worms-browser-');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:8000';
// Run against an isolated application/database: this test creates games.
(async () => {
 const browser = await chromium.launch({args:['--no-sandbox']});
 for (const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]) {
  const context = await browser.newContext({viewport, hasTouch:viewport.width<1000, isMobile:viewport.width<1000});
  const page = await context.newPage(); const errors=[]; const turns=[]; const posted=[];
  page.on('pageerror', e => {errors.push(e.message); console.log('BROWSER ERROR',e.message)});
  page.on('console', m => {if(m.type()==='error') {console.log('CONSOLE',m.text()); if(!m.text().includes('404')) errors.push(m.text());}});
  page.on('requestfailed', r => console.log('REQUEST FAILED',r.url(),r.failure()));
  page.on('response', async r => { if(r.url().endsWith('/turns') && r.request().method()==='POST') { turns.push(r.status()); if (r.status() === 200) posted.push(r.request().postDataJSON()); } });
  await page.goto(baseUrl);
  await page.locator('#game-mode').selectOption('solo');
  await page.locator('#computer-personality').selectOption('trickster');
  await page.locator('#worms-per-team').fill('2');
  await page.locator('#world-size').selectOption('small');
  await page.locator('button[type=submit]').click();
  await page.waitForSelector('body.my-turn', {timeout:20000,state:'attached'}).catch(async e=>{await page.screenshot({path:`${output}/failure.png`});throw e});
  await page.screenshot({path:`${output}/game-${viewport.width}.png`});
  assert.equal(await page.locator('.desktop-gate').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const touchHold = async (selector, ms) => {
    const box = await page.locator(selector).boundingBox();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
    await page.waitForTimeout(ms);
    await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
    await cdp.detach();
  };
  if(viewport.width<1000) await touchHold('[data-held=right]',200);
  // Skip a human turn using the same control path as a shot, then await CPU.
  const skip = page.locator('.hud-weapon[title*="Skip"]');
  await skip.click();

  await page.waitForSelector('.computer-turn[data-stage=thinking]', {timeout:15000});
  assert.match(await page.locator('.computer-turn__personality').innerText(), /Trickster/);
  const thinkingStarted = Date.now();
  assert.equal(await page.locator('.replay-frame').count(), 0);
  assert.equal(await page.getByRole('button', { name: '📽 Replays', exact: true }).count(), 0);
  await page.waitForSelector('.computer-turn[data-stage=aiming]', {timeout:30000});
  assert(Date.now() - thinkingStarted >= 900, 'computer introduction should be visible before acting');
  await page.screenshot({path:`${output}/computer-live-${viewport.width}.png`});
  assert.equal(await page.locator('.turn-card').count(), 0, 'solo has no async turn cards');
  assert.equal(await page.locator('body.replay-mode').count(), 0);

  await page.waitForSelector('body.my-turn',{timeout:60000,state:'attached'}).catch(async e=>{ console.log('STATE',await page.locator('body').innerText(),'TURNS',turns); await page.screenshot({path:`${output}/computer-failure.png`}); throw e; });
  assert.deepEqual(turns,[200,200]);
  const computerTurn = posted.find(t => t.player_position === 1);
  assert(computerTurn?.commands.runs.some(r => typeof r[2] === 'string' && r[2] !== 'skip'), 'computer must actually attack, never silently skip');
  assert.deepEqual(errors,[]);
  await page.reload(); await page.waitForSelector('body.my-turn',{timeout:20000,state:'attached'});
  let failedSave = false;
  await page.route('**/api/games/*/turns', async route => {
    if (route.request().method() === 'POST' && !failedSave) {
      failedSave = true; await route.fulfill({status:503,contentType:'application/json',body:'{}'});
    } else await route.continue();
  });
  await page.locator('.hud-weapon[data-id="bazooka"]').click();
  if (viewport.width < 1000) {
    await touchHold('[data-held=aimUp]',500);
    await touchHold('[data-held=charge]',350);
  } else {
    await page.keyboard.down('ArrowUp'); await page.waitForTimeout(500); await page.keyboard.up('ArrowUp');
    await page.keyboard.down('Space'); await page.waitForTimeout(350); await page.keyboard.up('Space');
  }
  await page.waitForSelector('.save-retry',{timeout:30000});
  const saved = page.waitForResponse(r=>r.url().endsWith('/turns')&&r.request().method()==='POST'&&r.status()===200);
  await page.locator('.save-retry button').click();
  await saved;
  await page.waitForSelector('.save-retry',{state:'detached'});
  assert.deepEqual(errors.filter(message => !message.includes('503')), [], 'No unexpected errors after firing and retry');
  console.log(`PASS ${viewport.width}x${viewport.height}: create, render, controls, visible CPU thinking/aiming, live attack, save, reload, charged shot, failed-save recovery`);
  await context.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
