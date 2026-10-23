from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
scale = 4
image = Image.new('RGBA', (256 * scale, 256 * scale))
draw = ImageDraw.Draw(image)
def box(values): return tuple(int(v * scale) for v in values)
def points(values): return [(int(x * scale), int(y * scale)) for x, y in values]
draw.rounded_rectangle(box((8, 8, 248, 248)), radius=48 * scale, fill='#193a53')
draw.polygon(points([(65,44),(153,44),(191,82),(191,212),(65,212)]), fill='#eef3f8')
draw.polygon(points([(153,44),(153,82),(191,82)]), fill='#c9dcea')
for y, end in [(107,158),(132,138),(157,126)]:
    draw.line(points([(90,y),(end,y)]), fill='#193a53', width=10*scale)
    for x in [90,end]: draw.ellipse(box((x-5,y-5,x+5,y+5)), fill='#193a53')
draw.ellipse(box((135,140,221,226)), fill='#4a80aa')
draw.line(points([(157,183),(171,197),(199,168)]), fill='white', width=11*scale, joint='curve')
for x,y in [(157,183),(171,197),(199,168)]: draw.ellipse(box((x-5.5,y-5.5,x+5.5,y+5.5)), fill='white')
image.save(root / 'assets' / 'presales-solution-tool.png')
image.save(root / 'assets' / 'presales-solution-tool.ico', sizes=[(n,n) for n in [16,24,32,48,64,128,256]])
print('Icon generated')
