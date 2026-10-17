import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInspectionAnswer, verifyFindings } from '../src/inspection/inspect.ts';
const receipt = { id:'r1',name:'compare_layouts',status:'ok',input:{split:'select'},output:{split:'select',baseline:{mean:{damaged:14}},champion:{mean:{damaged:0}}} };
test('visual explanations do not become verified without numeric evidence',()=>{
  const findings=verifyFindings({imageCheck:'X1Y2Z3',summary:'',findings:[{title:'Cause',observation:'Moving the sorter fixed damage'}]},[receipt]);
  assert.equal(findings[0].verification.status,'not_tested');
});
test('only exact referenced metric claims are supported; mismatches are refuted',()=>{
  const answer={imageCheck:'X1Y2Z3',summary:'',findings:[{title:'Damage',observation:'Measured',receiptIds:['r1'],claim:{metric:'damaged',split:'select' as const,baseline:14,champion:0}},{title:'Wrong',observation:'Measured',receiptIds:['r1'],claim:{metric:'damaged',split:'select' as const,baseline:10,champion:0}}]};
  const findings=verifyFindings(answer,[receipt]);
  assert.deepEqual(findings.map(f=>f.verification.status),['supported','refuted']);
  assert.equal(verifyFindings(answer,[{...receipt,status:'execution_failed'}])[0].verification.status,'not_tested');
});
test('reject malformed inspection output',()=>{
  assert.throws(()=>parseInspectionAnswer('{"imageCheck":1,"summary":"","findings":[]}'));
  assert.throws(()=>parseInspectionAnswer('{"imageCheck":"abc","summary":"","findings":[{}]}'));
});

test('descriptive references require one comparison; exact IDs disambiguate',()=>{
  const finding={title:'Damage',observation:'Measured',receiptIds:['compare_layouts select'],claim:{metric:'damaged',split:'select' as const,baseline:14,champion:0}};
  const answer={imageCheck:'X1Y2Z3',summary:'',findings:[finding]};
  assert.equal(verifyFindings(answer,[receipt])[0].verification.status,'supported');
  const other={...receipt,id:'r2',output:{...receipt.output,baseline:{mean:{damaged:20}}}};
  assert.equal(verifyFindings(answer,[receipt,other])[0].verification.status,'not_tested');
  const exact={...answer,findings:[{...finding,receiptIds:['r1','compare_layouts select']}]};
  assert.deepEqual(verifyFindings(exact,[receipt,other])[0].verification.receiptIds,['r1']);
  assert.equal(verifyFindings({...answer,findings:[{...finding,receiptIds:['r1','r2']}]},[receipt,other])[0].verification.status,'not_tested');
});

test('reject malformed references, confidence and claim fields from model output',()=>{
  const finding={title:'Damage',observation:'Measured',receiptIds:['r1'],confidence:'high',claim:{metric:'damaged',split:'select',baseline:14,champion:0}};
  const parse=(override:Record<string,unknown>)=>parseInspectionAnswer(JSON.stringify({imageCheck:'X1Y2Z3',summary:'',findings:[{...finding,...override}]}));
  for(const receiptIds of ['r1',[1],[''],Array(9).fill('r1'),null]) assert.throws(()=>parse({receiptIds}));
  for(const confidence of ['certain',1,null]) assert.throws(()=>parse({confidence}));
  for(const claim of [null,{...finding.claim,metric:'constructor'},{...finding.claim,split:'final'},{...finding.claim,baseline:'14'},{...finding.claim,champion:-1}]) assert.throws(()=>parse({claim}));
  assert.throws(()=>parseInspectionAnswer('{"imageCheck":"X1Y2Z3","summary":"","findings":[null]}'));
});

test('incomplete comparison output cannot support a claim',()=>{
  const answer={imageCheck:'X1Y2Z3',summary:'',findings:[{title:'Damage',observation:'Measured',receiptIds:['r1'],claim:{metric:'damaged',split:'select' as const,baseline:14,champion:0}}]};
  assert.equal(verifyFindings(answer,[{...receipt,output:{split:'select'}}])[0].verification.status,'not_tested');
});
