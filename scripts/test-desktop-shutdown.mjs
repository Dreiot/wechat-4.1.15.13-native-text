import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {createShutdownController} from '../apps/console-desktop/shutdown.cjs';

test('desktop quit waits for service shutdown and repeated quit requests share one stop',async()=>{
  let release,stops=0,finishes=0;const states=[];
  const gate=new Promise(resolve=>{release=resolve;});
  const quit=createShutdownController({stop:async()=>{stops++;await gate;},finish:()=>{finishes++;},onState:state=>states.push(state)});
  const first=quit.request(),second=quit.request();assert.equal(first,second);await nextTurn();
  assert.equal(stops,1);assert.equal(finishes,0);assert.equal(quit.running,true);
  release();assert.equal(await first,true);assert.equal(finishes,1);assert.equal(quit.finished,true);
  assert.deepEqual(states,['checking','stopping','stopped']);assert.equal(await quit.request(),true);assert.equal(stops,1);
});

test('canceling unsaved changes stops neither services nor the application',async()=>{
  let stops=0,finishes=0;const states=[];
  const quit=createShutdownController({confirm:async()=>false,stop:async()=>{stops++;},finish:()=>{finishes++;},onState:state=>states.push(state)});
  assert.equal(await quit.request(),false);assert.equal(stops,0);assert.equal(finishes,0);assert.equal(quit.running,false);assert.equal(quit.finished,false);
  assert.deepEqual(states,['checking','idle']);
});

test('failed cleanup preserves the application and a later quit can retry',async()=>{
  let attempts=0,finishes=0,errors=0;
  const quit=createShutdownController({stop:async()=>{if(++attempts===1)throw Error('fixture stop failed');},finish:()=>{finishes++;},onError:error=>{assert.match(error.message,/stop failed/);errors++;}});
  assert.equal(await quit.request(),false);assert.equal(quit.finished,false);assert.equal(finishes,0);assert.equal(errors,1);
  assert.equal(await quit.request(),true);assert.equal(attempts,2);assert.equal(finishes,1);
});
