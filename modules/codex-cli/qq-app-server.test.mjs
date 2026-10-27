import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rename, unlink, rmdir } from 'node:fs/promises';
import vm from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QqAppServer } from '../../src/qq-app-server.mjs';

const fixture = `
const rl=require('node:readline').createInterface({input:process.stdin});
let next=0;const counts=new Map();const active=new Map();
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
const notify=(method,params)=>send({method,params});
rl.on('line',line=>{const m=JSON.parse(line),p=m.params||{};
 const reply=result=>send({id:m.id,result});
 if(m.method==='initialize')return reply({});
 if(m.method==='initialized')return;
 if(m.method==='thread/start'||m.method==='thread/resume'){
  const id=p.threadId||'thread-'+(++next); if(id==='missing')return send({id:m.id,error:{code:-1,message:'Thread not found'}});
  return reply({thread:{id}});
 }
 if(m.method==='thread/unsubscribe')return reply({status:'unsubscribed'});
 if(m.method==='turn/interrupt'){
  reply({});notify('turn/completed',{threadId:p.threadId,turn:{id:p.turnId,status:'interrupted'}});return;
 }
 if(m.method!=='turn/start')return;
 const id=p.threadId,tid='turn-'+(++next),text=p.input[0].text;
 counts.set(id,(counts.get(id)||0)+1);active.set(id,tid);
 notify('turn/started',{threadId:id,turn:{id:tid,status:'inProgress'}});
 if(text==='crash')return process.exit(7);
 if(text==='timeout'){reply({turn:{id:tid}});return;}
 const finish=()=>{
  notify('item/completed',{threadId:id,turnId:tid,item:{type:'agentMessage',phase:'commentary',text:'do not send'}});
  notify('item/completed',{threadId:'unrelated',turnId:tid,item:{type:'agentMessage',text:'wrong conversation'}});
  notify('item/completed',{threadId:id,turnId:'wrong-turn',item:{type:'agentMessage',text:'wrong turn'}});
  notify('thread/tokenUsage/updated',{threadId:id,turnId:tid,tokenUsage:{total:{inputTokens:999},last:{inputTokens:12,cachedInputTokens:9,outputTokens:3}}});
  notify('item/completed',{threadId:id,turnId:tid,item:{type:'agentMessage',phase:'final_answer',text:JSON.stringify({text,pid:process.pid,count:counts.get(id),images:p.input.filter(x=>x.type==='localImage')})}});
  notify('turn/completed',{threadId:id,turn:{id:tid,status:text==='fail'?'failed':'completed',error:text==='fail'?{message:'test failed'}:null}});
 };
 if(text==='early'){finish();reply({turn:{id:tid}});}else{reply({turn:{id:tid}});setTimeout(finish,text==='slow'?100:5);}
});
`;

async function harness(fn, options={}) {
  const directory=await mkdtemp(join(tmpdir(),'qq-app-server-test-'));
  const path=join(directory,'mock.cjs');await writeFile(path,fixture);
  const client=new QqAppServer(process.execPath,[path],{rpcTimeoutMs:2000,...options});
  try { await fn(client); } finally {
    client.close(); await new Promise(resolve=>setTimeout(resolve,120));
    await unlink(path);await rmdir(directory);
  }
}
const run=(client,prompt,sessionId,extra={})=>client.run({prompt,sessionId,model:'same-model',effort:'low',...extra});

test('reuses process and loaded thread; images retained; per-turn tokens not cumulative',()=>harness(async client=>{
  let saved;const a=await run(client,'hello',undefined,{onSession:id=>{saved=id;},imagePaths:['C:/picture.png']});
  const b=await run(client,'second',saved);
  const one=JSON.parse(a.finalText),two=JSON.parse(b.finalText);
  assert.equal(one.pid,two.pid);assert.equal(two.count,2);assert.equal(a.sessionId,b.sessionId);
  assert.deepEqual(one.images,[{type:'localImage',path:'C:/picture.png'}]);
  assert.equal(b.usage.input_tokens,12);assert.equal(b.usage.cached_input_tokens,9);
  assert.equal(client.snapshot().activeTurns,0);
}));

test('events before start response are retained, commentary and wrong turns ignored',()=>harness(async client=>{
 const result=await run(client,'early');assert.equal(JSON.parse(result.finalText).text,'early');
}));

test('different conversations run concurrently without cross-delivery',()=>harness(async client=>{
 const [a,b]=await Promise.all([run(client,'slow'),run(client,'fast')]);
 assert.notEqual(a.sessionId,b.sessionId);assert.equal(JSON.parse(a.finalText).text,'slow');
 assert.equal(JSON.parse(b.finalText).text,'fast');
 assert.equal(JSON.parse(a.finalText).pid,JSON.parse(b.finalText).pid);
}));

test('failed turn does not return its candidate, erase session, or replay prompt',()=>harness(async client=>{
 let saved;await assert.rejects(run(client,'fail',undefined,{onSession:id=>{saved=id;}}),/test failed/);
 const result=await run(client,'next',saved);assert.equal(JSON.parse(result.finalText).count,2);
}));

test('timeout interrupts only its thread; unrelated turn completes',()=>harness(async client=>{
 const timeout=run(client,'timeout',undefined,{timeoutMs:50});
 const good=run(client,'slow');
 await assert.rejects(timeout,/timed out/);assert.equal(JSON.parse((await good).finalText).text,'slow');
 assert.equal(client.snapshot().activeTurns,0);
}));

test('crash rejects current work; later message restarts and resumes stored ID',()=>harness(async client=>{
 let saved;await assert.rejects(run(client,'crash',undefined,{onSession:id=>{saved=id;}}),/exited/);
 const reply=await run(client,'recovered',saved);assert.equal(reply.sessionId,saved);
 assert.equal(JSON.parse(reply.finalText).count,1);
}));

test('missing history is reported rather than silently discarding it',()=>harness(async client=>{
 await assert.rejects(run(client,'hello','missing'),/Thread not found/);
 assert.equal(client.snapshot().activeTurns,0);
}));

test('idle thread cache is bounded and evicted history can resume',()=>harness(async client=>{
 const a=await run(client,'one');await run(client,'two');
 assert.equal(client.snapshot().loadedThreads,1);
 const again=await run(client,'three',a.sessionId);assert.equal(again.sessionId,a.sessionId);
 assert.equal(client.snapshot().loadedThreads,1);
},{maxLoadedThreads:1}));

test('concurrent session saves leave one complete JSON map',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'qq-sessions-test-'));
 const path=join(directory,'sessions.json');
 const source=await readFile(new URL('../../src/server.js',import.meta.url),'utf8');
 const fragment=source.slice(source.indexOf('let qqSessionsSaveTask'),source.indexOf('async function clearQqSessions'));
 const sessions={}; const context=vm.createContext({Promise,Date,JSON,qqSessions:sessions,dataDir:directory,qqSessionsPath:path,mkdir:async()=>{},writeFile,rename});
 vm.runInContext(fragment,context);
 try {
  const saves=[];for(let i=0;i<20;i++){sessions['test-'+i]='thread-'+i;saves.push(context.saveQqSessions());}
  await Promise.all(saves);const stored=JSON.parse(await readFile(path,'utf8'));
  assert.deepEqual(stored.sessions,sessions);
 } finally {await unlink(path);await rmdir(directory);}
});
