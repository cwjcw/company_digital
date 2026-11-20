import { createUnifiedBomMatcher, simulateBomSource, type UnifiedBomHead, type BomSource } from './unified-bom.matcher';

const head=(source:BomSource,bomId='1',patch:Partial<UnifiedBomHead>={}):UnifiedBomHead=>({source,bomId,itemCode:'CODE',version:'A',approved:true,disabled:false,modifiedAt:'2026-11-01 12:00:00',auditedAt:'2026-11-02 12:00:00',...patch});
describe('Unified exact-code BOM existence',()=>{
  it.each< BomSource[][] >([[['e10-main']],[['tplus-kejia']],[['tplus-kainan']],[['e10-main','tplus-kejia']],[['e10-main','tplus-kejia','tplus-kainan']]])('accepts any effective sources %j',(sources)=>{
    expect(createUnifiedBomMatcher(sources.map(s=>head(s)),true)('CODE').status).toBe('HAS_BOM');
  });
  it('returns N internally without blank and matches exact untrimmed case-sensitive codes',()=>{
    const match=createUnifiedBomMatcher([head('tplus-kejia')],true);
    expect(match('MISSING').status).toBe('NO_BOM');expect(match('code').status).toBe('NO_BOM');expect(match('CODE ').status).toBe('NO_BOM');
  });
  it('rejects unapproved and disabled, accepts nondefault records without any E10 ITEM gate',()=>{
    expect(createUnifiedBomMatcher([head('tplus-kejia','1',{approved:false}),head('tplus-kainan','2',{disabled:true})],true)('CODE').status).toBe('NO_BOM');
    expect(createUnifiedBomMatcher([head('tplus-kejia')],true)('CODE')).toMatchObject({status:'HAS_BOM',bomSources:'科加智能'});
  });
  it('keeps all sources and versions but refuses to invent one approval date or use simulated latest',()=>{
    const rows=[head('e10-main'),head('tplus-kejia','2',{modifiedAt:'2026-11-03 12:00:00'})];
    expect(createUnifiedBomMatcher(rows,true)('CODE')).toMatchObject({status:'HAS_BOM',approvalDate:null,bomSources:'E10、科加智能'});
    expect(simulateBomSource(rows)).toMatchObject({latestSource:'tplus-kejia',reason:'CANDIDATE_ONLY'});
    expect(createUnifiedBomMatcher([...rows,head('tplus-kejia','3')],true)('CODE').approvalDate).toBeNull();
    expect(simulateBomSource([...rows,head('tplus-kejia','3')])).toMatchObject({latestSource:null,reason:'MULTIPLE_VERSIONS'});
  });
  it('keeps Y from last known effective sources while recording incomplete verification independently',()=>{
    expect(createUnifiedBomMatcher([head('tplus-kejia')],false)('CODE')).toMatchObject({status:'HAS_BOM',bomVerified:false});
    expect(createUnifiedBomMatcher([],false)('CODE')).toMatchObject({status:'NO_BOM',bomVerified:false});
  });
});
