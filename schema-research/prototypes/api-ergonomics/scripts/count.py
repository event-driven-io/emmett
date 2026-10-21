import re, os
styles=['today','a-builtin','b-zod','b2-valibot','b3-arktype','b4-effect','b5-typebox','c-type-first','d-grouped','e-interface','f-class']
def stats(text):
    lines=text.split('\n')
    nonblank=[l for l in lines if l.strip()]
    chars=len(re.sub(r'\s','',text))
    return len(nonblank), chars
def section(text, start, end):
    s=text.index(start); e=text.index(end)
    return text[s:e]
print(f"| Style | Definitions: non-blank lines | Definitions: non-whitespace chars | Both files: non-blank lines | Both files: non-whitespace chars | `typeof` count |")
print("|---|---|---|---|---|---|")
base=None
for st in styles:
    sc=open(f'styles/{st}/shoppingCart.ts').read(); bl=open(f'styles/{st}/businessLogic.ts').read()
    # definitions: events section + commands section (incl. imports)
    ev=section(sc, sc[:0] or sc[0], "/////////////////////////////////////////\n////////// Shopping Cart") if False else sc[:sc.index("/////////////////////////////////////////\n////////// Shopping Cart")]
    cm=bl[:bl.index("/////////////////////////////////////////\n////////// Business Logic")]
    dl,dc=stats(ev+cm); tl,tc=stats(sc+bl)
    ty=len(re.findall(r'\btypeof\b', sc+bl))
    if base is None: base=(dl,dc,tl,tc)
    pct=lambda a,b: f"{a} ({(a-b)*100/b:+.0f}%)" if st!='today' else str(a)
    print(f"| {st} | {pct(dl,base[0])} | {pct(dc,base[1])} | {pct(tl,base[2])} | {pct(tc,base[3])} | {ty} |")
