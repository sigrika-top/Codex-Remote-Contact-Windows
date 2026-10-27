import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { runQqCodexJson } from "../../src/qq-codex-runner.mjs";

const source = await readFile(new URL("../../src/server.js", import.meta.url), "utf8");
function extract(start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
const context = vm.createContext({
  state: { ai: {model: "gpt-6-luna", reasoningEffort: "low"}, qq: {webLookup: {enabled: true}} },
  join, __dirname: "C:/panel/src", codexWorkspaceDir: "C:/panel/workspaces/codex-cli",
  isFilesystemProbe: text => /密码|密钥/.test(text)
});
vm.runInContext(extract("function buildQqCodexArgs(", "async function loadQqPersonas("), context);
vm.runInContext(extract("function shouldUseWebLookup(", "function buildWebLookupQuery("), context);

test("identity small talk avoids search; real factual and explicit searches still work", () => {
  for (const text of ["你好", "你的主人是谁", "你是谁？", "你叫什么名字", "你用的是什么模型", "你的模型是什么", "你的名字叫什么", "刚才测试代号是什么？", "前面说的是什么"]) {
    assert.equal(context.shouldUseWebLookup({}, text), false, text);
  }
  for (const text of ["搜一下你的主人是谁", "爱因斯坦是谁", "最新新闻", "这个词是什么意思"]) {
    assert.equal(context.shouldUseWebLookup({}, text), true, text);
  }
});

test("QQ channel preference survives saved settings; iMessage remains disabled on Windows", async () => {
  let saved;
  const settingsContext = vm.createContext({
    state:{channels:{qq:false,imessage:false},ai:{},qq:{allowedGroups:[],ownerUserIds:[],bannedUserIds:[],enhancer:{enabled:true},proactive:{enabled:false,minIntervalMs:0}},imessage:{trustedHandles:[],replyHandle:""},remoteExecution:{},unifiedMemory:{}},
    isWindows:true,dataDir:"unused",settingsPath:"unused",Date,console,
    mkdir:async()=>{},readFile:async()=>JSON.stringify({channels:{qq:true,imessage:true}}),writeFile:async(_path,text)=>{saved=JSON.parse(text);},
    assistantName:"test",ownerLabel:"test",userAgentName:"test",assistantMentionAliases:[]
  });
  vm.runInContext(extract("async function loadSettings(", "function isValidReasoningEffort("),settingsContext);
  await settingsContext.loadSettings();
  assert.equal(settingsContext.state.channels.qq,true);
  assert.equal(settingsContext.state.channels.imessage,false);
  await settingsContext.saveSettings();
  assert.equal(saved.channels.qq,true);
  settingsContext.state.channels.qq=false;
  await settingsContext.saveSettings();
  assert.equal(saved.channels.qq,false);
});

test("new and resumed turns both retain model, images, JSON events, and chat configuration", () => {
  for (const sessionId of [undefined, "test-session"]) {
    const args = Array.from(context.buildQqCodexArgs({sessionId, outputPath: "out.txt", imagePaths: ["image.png"], catalogArgs: ["-c", "model_catalog_json=cache.json"]}));
    assert.equal(args.includes("resume"), Boolean(sessionId));
    for (const value of ["--json", "gpt-6-luna", 'model_reasoning_effort="low"', "--image", "image.png", "out.txt", "model_catalog_json=cache.json", "agents.enabled=false"]) assert.ok(args.includes(value), value);
    assert.ok(args.some(value => value.startsWith("model_instructions_file=")));
    assert.equal(args.at(-1), "-");
  }
});

test("page enrichment shares the search deadline instead of adding independent waits", async () => {
  const deadline = new AbortController();
  const webContext = vm.createContext({
    AbortController, AbortSignal, setTimeout, clearTimeout,
    qqWebLookupTimeoutMs: 1000, userAgentName: "test",
    htmlToPlainText: text => text,
    fetch: async (_url, {signal}) => {
      if (signal.aborted) throw signal.reason;
      return new Promise((resolve,reject) => signal.addEventListener("abort", () => reject(signal.reason), {once:true}));
    }
  });
  vm.runInContext(extract("async function enrichWebResults(", "function htmlToPlainText("), webContext);
  const started = Date.now();
  const timer = setTimeout(() => deadline.abort(), 25);
  const results = await webContext.enrichWebResults([{url:"https://one.example"},{url:"https://two.example"}],deadline.signal);
  clearTimeout(timer);
  assert.ok(Date.now()-started<250);
  assert.equal(results.length,2);
  assert.equal(results[0].snippet,"");
  assert.equal(results[1].snippet,"");
});

test("successful search is not blocked by Wikipedia and partial results survive provider failure", async () => {
  let wikiCalls = 0;
  const webContext = vm.createContext({
    AbortController,setTimeout,clearTimeout,Date,
    qqWebLookupTimeoutMs:100,
    state:{maintenance:{webLookup:{}}},
    buildWebQueryVariants: query => [query],
    chooseWebSearchProvider: () => "test",
    collectSearchProviderResults: async (_provider,_queries,_signal,output) => {
      output.push({url:"https://example.com",snippet:"A usable result"});
      throw new Error("a later variant timed out");
    },
    shouldUseWikipediaForQuery: () => true,
    searchWikipedia: async () => {wikiCalls++; throw new Error("must not wait for encyclopedia");},
    mergeSearchResults: values => values,
    enrichWebResults: async values => values
  });
  vm.runInContext(extract("async function searchWeb(", "function chooseWebSearchProvider("),webContext);
  const results = await webContext.searchWeb("Node.js 是什么？");
  assert.equal(wikiCalls,0);
  assert.equal(results.length,1);
  assert.equal(webContext.state.maintenance.webLookup.lastOk,true);
});

test("same conversation serializes; separate contacts remain independent; failures release queue", async () => {
  const running = new Map(), starts = [];
  const queueContext = vm.createContext({
    Date, Promise, crypto: {randomUUID: () => "anonymous"}, qqReplyTasks: new Map(),
    qqConversationKey: event => event.key,
    buildModelReplyUnqueued: async event => {
      assert.ok(!running.has(event.key));
      running.set(event.key, true); starts.push(event.id);
      await new Promise(resolve => setTimeout(resolve, 15));
      running.delete(event.key);
      if (event.fail) throw new Error("expected");
      return event.id;
    }
  });
  vm.runInContext(extract("async function buildModelReply(event)", "async function buildModelReplyUnqueued("), queueContext);
  const outcomes = await Promise.allSettled([
    queueContext.buildModelReply({key:"a",id:1,fail:true}),
    queueContext.buildModelReply({key:"a",id:2}),
    queueContext.buildModelReply({key:"b",id:3})
  ]);
  assert.deepEqual(starts,[1,3,2]);
  assert.equal(outcomes[0].status,"rejected");
  assert.equal(outcomes[1].value,2);
  assert.equal(queueContext.qqReplyTasks.size,0);
});

const scratch = await mkdtemp(join(tmpdir(), "qq-runner-test-"));
const fakeCli = join(scratch, "fake-cli.cjs");
await writeFile(fakeCli, `
let input='';process.stdin.on('data',chunk=>input+=chunk);
process.stdin.on('end',()=>{
const mode=process.env.QQ_TEST_MODE;
if(mode==='timeout') return setInterval(()=>{},1000);
if(mode==='exit') return process.exit(2);
const emit=value=>process.stdout.write(JSON.stringify(value)+'\\n');
emit({type:'thread.started',thread_id:'example-session'});
emit({type:'item.completed',item:{type:'agent_message',phase:'commentary',text:'never send this'}});
if(mode==='failure'){emit({type:'turn.failed',error:{message:'test failed'}});return;}
const final={type:'item.completed',item:{type:'agent_message',phase:'final_answer',text:'你好！'}};
const line=JSON.stringify(final)+'\\n';
process.stdout.write(line.slice(0,11));
setTimeout(()=>{
process.stdout.write(line.slice(11));
emit({type:'turn.completed',usage:{input_tokens:25}});
setTimeout(()=>process.exit(0),400);
},10);
});`);

test("successful complete turn returns before teardown, handles split JSON and UTF-8", async () => {
  let close;
  const closed = new Promise(resolve => close=resolve);
  const result = await runQqCodexJson(process.execPath,[fakeCli],"test",{timeout:3000,onClose:close});
  assert.equal(result.finalText,"你好！");
  assert.equal(result.sessionId,"example-session");
  assert.equal(result.usage.input_tokens,25);
  const timing = await closed;
  assert.ok(timing.closeMs-result.timing.completedMs>=250);
});

test("failed turns and early process exit never deliver candidate messages", async () => {
  for (const mode of ["failure","exit"]) {
    await assert.rejects(runQqCodexJson(process.execPath,[fakeCli],"test",{timeout:3000,env:{...process.env,QQ_TEST_MODE:mode}}), /test failed|exited with 2/);
  }
});

test("timeout terminates its own invocation and rejects", async () => {
  await assert.rejects(runQqCodexJson(process.execPath,[fakeCli],"test",{timeout:250,env:{...process.env,QQ_TEST_MODE:"timeout"}}),/timed out/);
});

test.after(async () => { await unlink(fakeCli); await rmdir(scratch); });
