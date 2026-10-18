import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStickerTags,validateStickerFile} from '../public/console/sticker-manager.js';
test('manual sticker metadata accepts Chinese tags without duplicate or oversized entries',()=>{
  assert.deepEqual(parseStickerTags('开心， 打招呼,开心'),['开心','打招呼']);
  assert.deepEqual(parseStickerTags(''),[]);
  assert.throws(()=>parseStickerTags('a,b,c,d,e,f,g'),/最多 6/);
  assert.throws(()=>parseStickerTags('字'.repeat(17)),/16 字/);
});
test('manual sticker picker limits local uploads before base64 allocation',()=>{
  for(const name of ['hi.GIF','hi.png','hi.jpg','hi.jpeg','hi.webp'])assert.doesNotThrow(()=>validateStickerFile({name,size:123}));
  for(const file of [{name:'script.svg',size:123},{name:'hi.gif',size:0},{name:'hi.gif',size:8*1024*1024+1}])assert.throws(()=>validateStickerFile(file));
});
