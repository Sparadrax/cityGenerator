/** Clip a global Voronoi diagram to ant-grown land and dissolve internal parcel seams. */
import {clip,voronoi} from './voronoi.mjs';

/**
 * Encode a ground-plane vertex with stable rounding.
 * @param p - Point with x/z coordinates.
 * @returns Quantized coordinate key with signed zero normalized.
 */
const key=p=>`${Math.round(p.x*100000)},${Math.round(p.z*100000)}`;

/**
 * Check whether both ends of a clipped edge lie along a parcel edge.
 * @param p - Clipped segment start.
 * @param q - Clipped segment end.
 * @param a - Parcel edge start.
 * @param b - Parcel edge end.
 * @returns True when the segments are collinear within clipping tolerance.
 */
function onEdge(p,q,a,b){
    const dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
    return Math.abs((p.x-a.x)*dz-(p.z-a.z)*dx)/length<1e-6&&Math.abs((q.x-a.x)*dz-(q.z-a.z)*dx)/length<1e-6;
}

/**
 * Generate continuous nearest-site blocks over a nonconvex union of land parcels.
 * @param sites - Global street-generation sites inside the land footprint.
 * @param patches - Adjoining convex hexagons covering exactly the occupied land.
 * @returns Block polygons and their source-site indices; internal hex seams are removed.
 */
export function landVoronoi(sites,patches){
    const edges=new Map();
    patches.forEach((polygon,tile)=>polygon.forEach((a,i)=>{
        const b=polygon[(i+1)%polygon.length],k=[key(a),key(b)].sort().join('|');
        if(!edges.has(k))edges.set(k,[]);edges.get(k).push(tile);
    }));
    const metadata=patches.map(polygon=>({polygon,minX:Math.min(...polygon.map(p=>p.x)),maxX:Math.max(...polygon.map(p=>p.x)),minZ:Math.min(...polygon.map(p=>p.z)),maxZ:Math.max(...polygon.map(p=>p.z)),internal:polygon.map((a,i)=>edges.get([key(a),key(polygon[(i+1)%polygon.length])].sort().join('|')).length>1)}));
    const all=patches.flat(),bounds=[{x:Math.min(...all.map(p=>p.x))-1,z:Math.min(...all.map(p=>p.z))-1},{x:Math.max(...all.map(p=>p.x))+1,z:Math.min(...all.map(p=>p.z))-1},{x:Math.max(...all.map(p=>p.x))+1,z:Math.max(...all.map(p=>p.z))+1},{x:Math.min(...all.map(p=>p.x))-1,z:Math.max(...all.map(p=>p.z))+1}];
    const diagram=voronoi(sites,bounds),blocks=[];
    diagram.forEach((cell,site)=>{
        if(cell.length<3)return;
        const minX=Math.min(...cell.map(p=>p.x)),maxX=Math.max(...cell.map(p=>p.x)),minZ=Math.min(...cell.map(p=>p.z)),maxZ=Math.max(...cell.map(p=>p.z));
        const segments=[];
        for(const tile of metadata){
            if(tile.maxX<minX||tile.minX>maxX||tile.maxZ<minZ||tile.minZ>maxZ)continue;
            let polygon=cell;
            for(let i=0;i<tile.polygon.length&&polygon.length;i++){
                const a=tile.polygon[i],b=tile.polygon[(i+1)%tile.polygon.length];
                polygon=clip(polygon,b.z-a.z,a.x-b.x,(b.z-a.z)*a.x+(a.x-b.x)*a.z);
            }
            for(let i=0;i<polygon.length;i++){
                const a=polygon[i],b=polygon[(i+1)%polygon.length];
                if(Math.hypot(b.x-a.x,b.z-a.z)<1e-6)continue;
                if(tile.polygon.some((p,j)=>tile.internal[j]&&onEdge(a,b,p,tile.polygon[(j+1)%tile.polygon.length])))continue;
                segments.push({a,b});
            }
        }
        const starts=new Map();segments.forEach((s,i)=>{const k=key(s.a);if(!starts.has(k))starts.set(k,[]);starts.get(k).push(i);});
        const used=new Set();
        for(let i=0;i<segments.length;i++){
            if(used.has(i))continue;
            const polygon=[],first=key(segments[i].a);let index=i,closed=false;
            for(let step=0;step<=segments.length;step++){
                if(used.has(index))break;const segment=segments[index];used.add(index);polygon.push(segment.a);
                if(key(segment.b)===first){closed=true;break;}
                const next=starts.get(key(segment.b))?.find(n=>!used.has(n));
                if(next===undefined)throw new Error('Voronoi land boundary failed to close.');index=next;
            }
            if(closed&&polygon.length>=3)blocks.push({polygon,site});
        }
    });
    return blocks;
}
