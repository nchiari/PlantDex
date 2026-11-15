"""Emblema de Herbalorium: medallón con una planta grabada, pimpollo dorado y laureles.\nUso: python3 tools/emblema.py tools/emblema.svg (después, tools/variante.py lo inyecta en la variante)."""
import math,sys
def P(x,y): return f"{x:.2f} {y:.2f}"
VEIN='style="stroke:var(--emb-vein,#f7f2e3)"'
def leaf(bx,by,ang,L,W,belly=0.42):
    a=math.radians(ang); ux,uy=math.cos(a),math.sin(a); nx,ny=-uy,ux
    tx,ty=bx+ux*L,by+uy*L
    c1=(bx+ux*L*belly+nx*W*1.25, by+uy*L*belly+ny*W*1.25); c1b=(bx+ux*L*0.85+nx*W*0.55, by+uy*L*0.85+ny*W*0.55)
    c2=(bx+ux*L*belly-nx*W*1.25, by+uy*L*belly-ny*W*1.25); c2b=(bx+ux*L*0.85-nx*W*0.55, by+uy*L*0.85-ny*W*0.55)
    outline=f"M{P(bx,by)}C{P(*c1)} {P(*c1b)} {P(tx,ty)}C{P(*c2b)} {P(*c2)} {P(bx,by)}Z"
    mid=f"M{P(bx+ux*L*0.18,by+uy*L*0.18)}Q{P(bx+ux*L*0.55+nx*W*0.12,by+uy*L*0.55+ny*W*0.12)} {P(bx+ux*L*0.86,by+uy*L*0.86)}"
    return outline,mid
def emblem():
    o=[]
    o.append('<circle cx="32" cy="32" r="30.3" fill="none" stroke="currentColor" stroke-width="1.6"/>')
    o.append('<circle cx="32" cy="32" r="27.7" fill="none" stroke="currentColor" stroke-width=".6"/>')
    # tallo fino que se afina hacia arriba
    o.append('<path d="M31.0 52.2C30.6 45 32.5 39 31.55 31C31.05 25.5 31.75 20.5 31.8 15.5L32.2 15.5C32.25 20.5 32.95 25.5 32.45 31C33.4 39 31.4 45 33.0 52.2Z" fill="currentColor"/>')
    leaves=[(31.7,45.5,-148,13.5,3.7),(32.3,40.6,-30,13,3.6),(31.6,34.6,-146,11,3.1),(32.4,29.6,-34,10,2.9),(31.75,24.2,-138,7.4,2.2),(32.25,20.6,-44,6.4,1.9)]
    for bx,by,ang,L,W in leaves:
        ol,mid=leaf(bx,by,ang,L,W)
        o.append(f'<path d="{ol}" fill="currentColor"/>')
        o.append(f'<path d="{mid}" fill="none" stroke-width=".55" stroke-linecap="round" {VEIN}/>')
    # pimpollo dorado
    o.append('<path d="M32 16.6C29.7 16.3 28.7 14 29.3 11.2C30.2 12 30.9 12.4 31.3 12.5C31.4 10.6 31.6 9.4 32 8.6C32.4 9.4 32.6 10.6 32.7 12.5C33.1 12.4 33.8 12 34.7 11.2C35.3 14 34.3 16.3 32 16.6Z" fill="#c4a65a" stroke="currentColor" stroke-width=".7" stroke-linejoin="round"/>')
    # laureles a lo largo de un arco
    for s in (-1,1):
        def pt(t):  # arco desde la base (t=0) hacia arriba al costado (t=1)
            a=math.radians(90+s*(14+t*78)); r=22.6
            return 32+r*math.cos(a), 32+r*math.sin(a)
        pts=[pt(i/20) for i in range(21)]
        o.append('<path d="M'+" L".join(P(*p) for p in pts)+'" fill="none" stroke="currentColor" stroke-width=".85" stroke-linecap="round"/>')
        for i,t in enumerate((0.12,0.3,0.48,0.66,0.84)):
            x,y=pt(t); x2,y2=pt(t+0.05); tang=math.degrees(math.atan2(y2-y,x2-x))
            for side in (-1,1):
                ang=tang+side*38
                Lf=4.6-0.5*t*2; ol,mid=leaf(x,y,ang,Lf,1.35)
                o.append(f'<path d="{ol}" fill="currentColor"/>')
        xe,ye=pt(1.0); x2,y2=pt(0.96); tang=math.degrees(math.atan2(ye-y2,xe-x2))
        ol,mid=leaf(xe,ye,tang,4.2,1.3); o.append(f'<path d="{ol}" fill="currentColor"/>')
    # lazo al pie
    o.append('<path d="M28.6 54.4C30.4 53.3 33.6 53.3 35.4 54.4C33.6 55.5 30.4 55.5 28.6 54.4Z" fill="#c4a65a" stroke="currentColor" stroke-width=".6"/>')
    return "\n".join(o)
open(sys.argv[1],'w').write('<symbol id="i-emblem" viewBox="0 0 64 64">\n'+emblem()+'\n</symbol>')
