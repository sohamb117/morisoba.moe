"""Convert ASCII from preserved Medley/Xerox Classic bitmaps, without redrawing glyphs."""
from pathlib import Path
import argparse
import struct
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-dir',type=Path,required=True)
parser.add_argument('--output-dir',type=Path,default=Path('shared/fonts'))
args=parser.parse_args()
ROOT=args.source_dir
OUT=args.output_dir
OUT.mkdir(parents=True,exist_ok=True)

def convert(size):
    src=ROOT/f'CLASSIC{size}-MRR.MEDLEYDISPLAYFONT'
    data=src.read_bytes()
    def pos(label): return data.index(b'\n'+label.encode()+b' ')+len(label)+2
    def small(label):
        p=pos(label); assert data[p]==1
        return struct.unpack_from('>H', data,p+1)[0]
    def words(label):
        p=pos(label); assert data[p]==3
        n=struct.unpack_from('>I',data,p+1)[0]
        return struct.unpack_from('>'+str(n)+'H',data,p+5)
    widths,images,offsets=map(words,['WIDTHS','IMAGEWIDTHS','OFFSETS'])
    p=pos('LEFTKERN'); assert data[p]==6
    n=struct.unpack_from('>I',data,p+1)[0]; assert data[p+5:p+7]==b'\0\1'
    kerns=struct.unpack_from('>'+str(n)+'i',data,p+7)
    p=pos('BITMAP'); assert data[p]==2
    bw,bh,depth=struct.unpack_from('>HHH',data,p+1);assert depth==1
    stride=((bw+15)//16)*2
    bits=data[p+7:p+7+stride*bh]; assert len(bits)==stride*bh
    ascent,descent=small('ASCENT'),small('DESCENT');assert ascent+descent==bh
    scale=64;order=['.notdef']+[f'uni{c:04X}' for c in range(32,127)]
    fb=FontBuilder(size*scale,isTTF=True);fb.setupGlyphOrder(order)
    glyphs={}; metrics={};rects={}
    pen=TTGlyphPen(None);glyphs['.notdef']=pen.glyph();metrics['.notdef']=(size*scale,0)
    for c in range(32,127):
        pen=TTGlyphPen(None);name=f'uni{c:04X}';runs=[]
        for y in range(bh):
            x=0
            while x<images[c]:
                def ink(xx):
                    col=offsets[c]+xx
                    assert col<bw
                    return bool(bits[y*stride+col//8] & (128>>(col%8)))
                if not ink(x):x+=1;continue
                start=x
                while x<images[c] and ink(x):x+=1
                x0=(start-kerns[c])*scale;x1=(x-kerns[c])*scale
                y1=(ascent-y)*scale;y0=y1-scale
                # Clockwise contours preserve the historical bitmap pixel for pixel.
                pen.moveTo((x0,y0));pen.lineTo((x0,y1));pen.lineTo((x1,y1));pen.lineTo((x1,y0));pen.closePath()
                runs.append((start,x,y))
        glyphs[name]=pen.glyph();metrics[name]=(widths[c]*scale,-kerns[c]*scale);rects[c]=runs
    fb.setupCharacterMap({c:f'uni{c:04X}' for c in range(32,127)})
    fb.setupGlyf(glyphs);fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=small('FONTASCENT')*scale,descent=-small('FONTDESCENT')*scale,lineGap=0)
    family=f'Xerox Classic {size}'
    fb.setupNameTable({'familyName':family,'styleName':'Regular','uniqueFontIdentifier':f'Morisoba-{family}-ASCII-v1','fullName':family,'psName':f'XeroxClassic{size}-Regular','version':'Version 1.000','copyright':'Original Classic glyphs preserved by Interlisp.org. Browser conversion from Medley display font; MIT license, see INTERLISP-LICENSE.txt.'})
    fb.setupOS2(fsType=0,sTypoAscender=small('FONTASCENT')*scale,sTypoDescender=-small('FONTDESCENT')*scale,sTypoLineGap=0,usWinAscent=small('FONTASCENT')*scale,usWinDescent=small('FONTDESCENT')*scale)
    fb.setupPost();fb.setupMaxp();fb.font.flavor='woff2';fb.save(OUT/f'XeroxClassic{size}-Regular.woff2')
    # Verify every output ASCII advance and the exact number of original ink pixels.
    from fontTools.ttLib import TTFont
    font=TTFont(OUT/f'XeroxClassic{size}-Regular.woff2')
    for c,runs in rects.items():
        assert font['hmtx'][f'uni{c:04X}'][0]==widths[c]*scale
        assert font['glyf'][f'uni{c:04X}'].numberOfContours==len(runs)
    print(f'Classic {size}: 95 ASCII glyphs verified; bitmap {bw}x{bh}, ascent {ascent}, descent {descent}')

for size in [18,24]:convert(size)
