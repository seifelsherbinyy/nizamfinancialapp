import json,pathlib,re
root=pathlib.Path(__file__).resolve().parent
d=json.loads((root/'discovered.json').read_text(encoding='utf-8'));s=json.loads((root/'shortlist.json').read_text(encoding='utf-8'));e=json.loads((root/'exclusions.json').read_text(encoding='utf-8'));t=json.loads((root/'tokens/design-tokens.json').read_text(encoding='utf-8'))
assert len(d)==96 and len({x['repo'] for x in d})==96
assert sum(x['decision']=='EXCLUDED' for x in d)==len(e)==84
assert sum(x['decision']!='EXCLUDED' for x in d)+len(e)==len(d)
allowed={'MIT','Apache-2.0','ISC','BSD-2-Clause','BSD-3-Clause','MPL-2.0'}; assert all(x['licence'] in allowed for x in s)
required={'name','url','category','licence','stars','star_velocity_90d','last_commit','weekly_downloads_or_na','gzip_kb','types','a11y_notes','score','score_breakdown','confidence','verified_at','evidence_urls','surface_fit','integration_days','risks'};assert all(required<=set(x) for x in s)
w={'fitness_to_surface':.25,'maintenance_health':.20,'licence_safety':.15,'integration_cost':.15,'design_quality':.15,'bundle_and_perf':.10}
for x in s:
 assert x['verified_at']=='2026-08-07' and len(x['evidence_urls'])>=3
 assert abs(x['score']-round(sum(x['score_breakdown'][k]*v for k,v in w.items()),2))<1e-9
 assert isinstance(x['gzip_kb'],str) or x['gzip_kb']<=100
assert len(s)==8 and len(list((root/'integration').glob('*.md')))==8 and len(list((root/'conditional').glob('*.md')))==1
assert t['meta']['status']=='PROPOSAL'
text=(root/'REPORT.md').read_text(encoding='utf-8');bluf=text.split('## BLUF',1)[1].split('## Method',1)[0]
assert len(re.findall(r"\b[\w'-]+\b",bluf))<=120 and '\u2014' not in text and 'Owner: Seif' in text
assert '96 discovered = 12 retained or shortlisted + 84 excluded. PASS.' in text
for p in (root/'integration').glob('*.md'):
 body=p.read_text(encoding='utf-8'); assert '**Install:**' in body and '**Test:**' in body and '**Removal cost:**' in body and '```tsx' in body
m=(root/'EVIDENCE_MATRIX.md').read_text(encoding='utf-8'); rows=sum(1 for line in m.splitlines() if line.startswith('| ') and not line.startswith('|---') and 'Candidate | Metric' not in line); assert rows==len(s)*5
print(f'PASS discovered={len(d)} retained={sum(x["decision"]!="EXCLUDED" for x in d)} excluded={len(e)} shortlist={len(s)} playbooks=8 conditional=1 evidence_rows={rows}')
