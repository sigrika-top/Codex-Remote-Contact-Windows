import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, rmdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { extractOneBotImageInputs, prepareQqModelImages } from '../../src/qq-image-fallback.mjs';

test('real OneBot segment and CQ text resolve to one media ID',()=>{
 const input={message:[{type:'image',data:{file:'01234567-89ab-cdef-0123-456789abcdef',url:'https://multimedia.nt.qq.com.cn/test'}}],raw_message:'[CQ:image,file=01234567-89ab-cdef-0123-456789abcdef]'};
 const images=extractOneBotImageInputs(input);
 assert.equal(images.length,1);assert.equal(images[0].file,'01234567-89ab-cdef-0123-456789abcdef');
 assert.equal(extractOneBotImageInputs({raw_message:input.raw_message}).length,1);
 assert.deepEqual(extractOneBotImageInputs({message:[{type:'image',data:{file:'../../auth.json'}}]}),[]);
});

test('private image-only messages request vision; unrelated group images keep their gate',async()=>{
 const source=await readFile(new URL('../../src/server.js',import.meta.url),'utf8');
 const part=source.slice(source.indexOf('function shouldInspectQqImages('),source.indexOf('function isQqImageLookRequest('));
 const context=vm.createContext({hasAnyQqImageReference:event=>Boolean(event.images?.length),isExplicitQqAtEvent:()=>false,isQqImageLookRequest:()=>false,scoreQqTextInterest:()=>0});
 vm.runInContext(part,context);
 assert.equal(context.shouldInspectQqImages({type:'private_message',images:[{file:'img'}]},''),true);
 assert.equal(context.shouldInspectQqImages({type:'group_message',images:[{file:'img'}]},''),false);
});

test('OneBot-local image is validated and passed as local image; failures are reported',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'qq-image-'));
 const path=join(directory,'image.jpg');
 await writeFile(path,Buffer.from([0xff,0xd8,0xff,0xd9]));
 try {
  const images=await prepareQqModelImages([{file:'img-1'}],{fetchOneBotImage:async()=>({file:path})});
  assert.deepEqual(images,[path]);
  let failures=0;
  const missing=await prepareQqModelImages([{file:'img-1'}],{fetchOneBotImage:async()=>({file:join(directory,'missing')}),onError:()=>failures++});
  assert.deepEqual(missing,[]);assert.equal(failures,1);
 } finally {await unlink(path);await rmdir(directory);}
});
