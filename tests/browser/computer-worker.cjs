const {webkit}=require('playwright');
const assert=require('node:assert/strict');
const baseUrl=process.env.BASE_URL || 'http://127.0.0.1:8125/worms/';
// Isolated database only: creates two games and records test turns.
(async()=>{
 const b=await webkit.launch({headless:true});
 for(const blockWorker of [false,true]) {
  const p=await b.newPage({viewport:{width:390,height:844},hasTouch:true});
  const errors=[],posts=[],workers=[]; let fallback=false;
  p.on('pageerror',e=>errors.push(e.message));
  p.on('console',m=>{if(m.text().includes('using local planner'))fallback=true;});
  p.on('request',r=>{if(r.url().includes('computer-worker'))workers.push(r.url());});
  p.on('response',r=>{if(r.request().method()==='POST'&&r.url().endsWith('/turns')&&r.status()===200)posts.push(r.request().postDataJSON());});
  if(blockWorker)await p.route('**/computer-worker-*.js',r=>r.abort());
  await p.goto(baseUrl);
  await p.locator('#game-mode').selectOption('solo');
  await p.locator('#worms-per-team').fill('2');
  await p.locator('#world-size').selectOption('small');
  await p.locator('button[type=submit]').click();
  await p.waitForSelector('body.my-turn',{state:'attached'});
  await p.locator('.hud-weapon[data-id=skip]').click();
  await p.waitForSelector('.computer-turn[data-stage=thinking]');
  await p.waitForSelector('.computer-turn[data-stage=aiming]',{timeout:20000});
  await p.waitForSelector('body.my-turn',{state:'attached',timeout:30000});
  const cpu=posts.find(t=>t.player_position===1);
  assert(cpu?.commands.runs.some(r=>typeof r[2] === 'string' && r[2] !== 'skip'), 'CPU must attack');
  assert.deepEqual(errors,[]);assert.equal(fallback,blockWorker);
  assert(workers.length > 0);
  assert(workers.every(u=>u.startsWith(new URL('build/assets/',baseUrl).href)));
  console.log(`PASS WebKit /worms/: visible real attack; ${blockWorker?'blocked-worker local fallback':'worker loads correctly'}`);
  await p.close();
 }
 await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
