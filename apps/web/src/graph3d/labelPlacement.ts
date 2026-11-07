export interface LabelRect { left: number; top: number; right: number; bottom: number }
/** A screen-space grid keeps label avoidance bounded even for a large vault. */
export class LabelOccupancy {
  private cells = new Map<string, LabelRect[]>();
  private keys(rect: LabelRect): string[] {
    const keys: string[] = [];
    for(let x=Math.floor(rect.left/64);x<=Math.floor(rect.right/64);x++)
      for(let y=Math.floor(rect.top/64);y<=Math.floor(rect.bottom/64);y++) keys.push(x+":"+y);
    return keys;
  }
  add(rect: LabelRect): void { for(const key of this.keys(rect)) { const cell=this.cells.get(key)??[];cell.push(rect);this.cells.set(key,cell); } }
  overlaps(rect: LabelRect): boolean { return this.keys(rect).some(key=>this.cells.get(key)?.some(other=>rect.left<other.right&&rect.right>other.left&&rect.top<other.bottom&&rect.bottom>other.top)); }
}
export function placeGraphLabel(occupied: LabelOccupancy, x: number, y: number, radius: number, textWidth: number, width: number, height: number): LabelRect | null {
  const w=Math.min(width-8,textWidth+8),h=20,gap=radius+7;
  for(const [left,top] of [[x-w/2,y+gap],[x-w/2,y-gap-h],[x+gap,y-h/2],[x-gap-w,y-h/2]]) {
    const rect={left,top,right:left+w,bottom:top+h};
    if(rect.left<4||rect.right>width-4||rect.top<4||rect.bottom>height-4||occupied.overlaps(rect)) continue;
    occupied.add(rect);return rect;
  }
  return null;
}
