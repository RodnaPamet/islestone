import os,re,sys,hashlib,collections
def files(root):
    out=[]
    for d,_,fs in os.walk(root):
        for f in fs:
            if f.endswith(('.ts','.tsx')): out.append(os.path.join(d,f))
    return out
def norm_lines(p):
    try: t=open(p,encoding='utf-8',errors='replace').read()
    except: return []
    ls=[]
    for l in t.splitlines():
        l=l.strip()
        if not l or l.startswith(('//','*','/*','import ','export {','}',')','{')) or len(l)<12: continue
        ls.append(re.sub(r'\s+',' ',l))
    return ls
dub=files(sys.argv[1]); inf=[f for r in sys.argv[2:] for f in files(r)]
idx=collections.defaultdict(set)
dl={}
for f in dub:
    ls=set(norm_lines(f)); dl[f]=ls
    for l in ls: idx[l].add(f)
res=[]
for f in inf:
    ls=set(norm_lines(f))
    if not ls: continue
    hits=collections.Counter()
    for l in ls:
        for d in idx.get(l,()): hits[d]+=1
    if not hits: res.append((0,0,f,'')); continue
    d,c=hits.most_common(1)[0]
    res.append((c/len(ls),c,f,d))
res.sort(reverse=True)
b=collections.Counter()
for r,c,f,d in res:
    k='>=50%' if r>=.5 else '20-50%' if r>=.2 else '5-20%' if r>=.05 else '<5%'
    b[k]+=1
print('inflect files',len(res),dict(b))
open(sys.argv[0]+".tsv","w").write("\n".join(f"{r:.3f}\t{c}\t{f}\t{d}" for r,c,f,d in res))
for r,c,f,d in []:
    print(f'{r:5.0%} {c:4d}  {f.split("inflect-compliance/")[-1]}  <- {d.split("dub/")[-1]}')
