/** Keep ant-grown land fixed; global Voronoi boundaries supply streets and repeated district types. */
import {antFootprint} from './antFootprint.mjs';
import {landVoronoi} from './landVoronoi.mjs';

/**
 * Build global Voronoi streets inside the ant-shaped footprint, then color regional neighborhoods.
 * @param size - City-size setting controlling land dimensions and the desired number of blocks.
 * @param random - Seeded random source returning values in [0, 1).
 * @param dotCount - Number of ant colony anchor dots; defaults to seven.
 * @returns Neighborhood instances, shared Voronoi borders, original land parcels, and colony statistics.
 */
export function createNeighborhoods(size,random,dotCount=7){
    const {tiles,optimization,route}=antFootprint(random,dotCount),radius=Math.max(3,size*.8);
    const patches=tiles.map(tile=>{
        const x=Math.sqrt(3)*radius*(tile.q+tile.r/2),z=1.5*radius*tile.r;
        return Array.from({length:6},(_,i)=>{const angle=(30+i*60)*Math.PI/180;return {x:x+Math.cos(angle)*radius,z:z+Math.sin(angle)*radius};});
    });
    const sites=[],target=Math.max(20,Math.round(size*size/2));
    for(let i=0;i<target;i++){
        const tile=tiles[Math.floor(random()*tiles.length)],angle=random()*Math.PI*2,length=Math.sqrt(random())*radius*.78;
        sites.push({x:Math.sqrt(3)*radius*(tile.q+tile.r/2)+Math.cos(angle)*length,z:1.5*radius*tile.r+Math.sin(angle)*length});
    }
    const blocks=landVoronoi(sites,patches),hubs=[0],regions=Math.min(15,Math.max(10,Math.round(Math.sqrt(target))));
    while(hubs.length<regions){
        let best=-1,score=-1;
        sites.forEach((p,i)=>{if(hubs.includes(i))return;const nearest=Math.min(...hubs.map(h=>Math.hypot(p.x-sites[h].x,p.z-sites[h].z)));if(nearest>score){score=nearest;best=i;}});hubs.push(best);
    }
    // Region identity is separate from district type, so colors/types can recur across the map.
    const offset=Math.floor(random()*5),clusters=hubs.map((site,id)=>({id,typeId:(id+offset)%5,patches:[],sites:[],cells:[],center:sites[site],radius:1}));
    for(const block of blocks){
        const site=sites[block.site];let owner=0,best=Infinity;
        hubs.forEach((hub,id)=>{const d=Math.hypot(site.x-sites[hub].x,site.z-sites[hub].z);if(d<best){best=d;owner=id;}});
        const cluster=clusters[owner];cluster.sites.push(site);cluster.cells.push(block.polygon);cluster.patches.push(block.polygon);
    }
    const links=[],edges=new Map();
    clusters.forEach(cluster=>{
        cluster.radius=Math.max(1,...cluster.cells.flat().map(p=>Math.hypot(p.x-cluster.center.x,p.z-cluster.center.z)));
        for(const polygon of cluster.cells)for(let i=0;i<polygon.length;i++){
            const a=polygon[i],b=polygon[(i+1)%polygon.length],key=[a,b].map(p=>`${Math.round(p.x*10000)},${Math.round(p.z*10000)}`).sort().join('|');
            const other=edges.get(key);if(other!==undefined&&other!==cluster.id)links.push({from:other,to:cluster.id,points:[a,b],shared:true});else edges.set(key,cluster.id);
        }
    });
    return {clusters,links,optimization,tiles,route,landPatches:patches};
}
